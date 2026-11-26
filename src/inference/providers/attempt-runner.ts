import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { ReadProviderAccountQuotaCommand } from "@/quota-meters/commands/impl/read-provider-account-quota.command";
import type { UpstreamProtocol } from "@/db/schemas";
import type { SnapshotProviderAccount } from "@/snapshot/models/snapshot";
import { MarkProviderAccountExhaustedCommand } from "@/upstream/commands/impl/mark-provider-account-exhausted.command";
import { SIGN_IN_AGAIN_REASON } from "@/upstream/models/oauth-login";
import {
  apiKeyCredential,
  CredentialUnavailableError,
  OauthLoginRefusedError,
  type ProviderAccountCredential,
} from "@/upstream/models/provider-account-credential";
import { CooldownStore } from "@/upstream/providers/cooldown-store";
import {
  type CredentialReadOptions,
  ProviderAccountCredentials,
} from "@/upstream/providers/provider-account-credentials";
import { ProviderAccountHealth } from "@/upstream/providers/provider-account-health";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher";
import {
  AttemptFailedError,
  exhaustionError,
  gatewayErrorFor,
} from "@/inference/models/attempt-failure";
import { exhaustedUntilOf } from "@/inference/models/quota-exhausted-error";
import {
  type AttemptPath,
  type AttemptTarget,
  attemptTargets,
} from "@/inference/models/route-selection";
import type { Destination } from "@/inference/models/destination";
import type { SentServiceTier } from "@/inference/models/service-tier";
import type { UsageMeter } from "@/inference/models/usage-meter";

export const MAX_ATTEMPTS_PER_REQUEST = 5;

const DISABLING_REFUSAL_COUNT = 3;

const DISABLES_REFUSED_LOGIN: CredentialReadOptions = { disablesRefusedLogin: true };
const LEAVES_REFUSED_LOGIN_ENABLED: CredentialReadOptions = { disablesRefusedLogin: false };

export interface PreparedAttempt<Answer> {
  upstreamProtocol: UpstreamProtocol;
  sentServiceTier: SentServiceTier | null;
  send(credential: ProviderAccountCredential): Promise<Answer>;
}

@Injectable()
export class AttemptRunner {
  private readonly logger = new Logger(AttemptRunner.name);

  constructor(
    private readonly cipher: ProviderKeyCipher,
    private readonly credentials: ProviderAccountCredentials,
    private readonly cooldowns: CooldownStore,
    private readonly providerAccountHealth: ProviderAccountHealth,
    private readonly commandBus: CommandBus,
  ) {}

  answer<Answer>(
    destination: Destination,
    meter: UsageMeter,
    prepare: (target: AttemptTarget) => PreparedAttempt<Answer>,
  ): Promise<Answer> {
    if (destination.kind === "probe") {
      return this.probeAnswer(destination.target, meter, prepare);
    }
    return this.firstAnswer(destination.paths, meter, prepare);
  }

  async firstAnswer<Answer>(
    paths: AttemptPath[],
    meter: UsageMeter,
    prepare: (target: AttemptTarget) => PreparedAttempt<Answer>,
  ): Promise<Answer> {
    const enabledAccountIds = enabledProviderAccountIdsOf(paths);
    const cooldowns = await this.cooldowns.recentCooldowns(enabledAccountIds);
    const skippedAccountIds = new Set(cooldowns.keys());
    const recordedExhaustedAccountIds = new Set<string>();
    const failures: AttemptFailedError[] = [];
    const targets = attemptTargets(paths, (target) => {
      const accountId = target.providerAccount.id;
      if (!skippedAccountIds.has(accountId)) {
        return false;
      }
      if (
        cooldowns.get(accountId)?.cause === "exhausted" &&
        !recordedExhaustedAccountIds.has(accountId)
      ) {
        recordedExhaustedAccountIds.add(accountId);
        meter.attemptSkippedAsExhausted(target);
      }
      return true;
    });
    for (const target of targets) {
      if (failures.length === MAX_ATTEMPTS_PER_REQUEST) {
        break;
      }
      try {
        const answer = await this.attemptWithCredential(
          target,
          prepare(target),
          meter,
          DISABLES_REFUSED_LOGIN,
        );
        void this.cooldowns.resetRefusalsAfterSuccess(target.providerAccount.id);
        return answer;
      } catch (error) {
        if (!(error instanceof AttemptFailedError)) {
          throw error;
        }
        meter.attemptFailed(error);
        failures.push(error);
        skippedAccountIds.add(target.providerAccount.id);
        await this.afterFailedAttempt(error, target);
        if (error.reason === "bad_request") {
          throw gatewayErrorFor(error);
        }
      }
    }
    throw exhaustionError(
      failures,
      enabledAccountIds.map((id) => cooldowns.get(id)?.cause ?? null),
    );
  }

  private async probeAnswer<Answer>(
    target: AttemptTarget,
    meter: UsageMeter,
    prepare: (target: AttemptTarget) => PreparedAttempt<Answer>,
  ): Promise<Answer> {
    try {
      return await this.attemptWithCredential(
        target,
        prepare(target),
        meter,
        LEAVES_REFUSED_LOGIN_ENABLED,
      );
    } catch (error) {
      if (!(error instanceof AttemptFailedError)) {
        throw error;
      }
      meter.attemptFailed(error);
      throw gatewayErrorFor(error);
    }
  }

  async afterFailedAttempt(
    failure: AttemptFailedError,
    { route, upstreamModel, providerAccount }: AttemptTarget,
  ): Promise<void> {
    const path = route ? `Route ${route.id}` : `Upstream Model ${upstreamModel.id} (direct)`;
    this.logger.warn(
      `Attempt failed (${failure.reason}, status ${failure.upstreamStatus ?? "none"}) ` +
        `on ${path}, Provider Account ${providerAccount.id}: ${failure.message}`,
    );
    const lastError = `${failure.reason}: ${failure.message}`;
    switch (failure.reason) {
      case "bad_request":
        return;
      case "unauthorized":
        if (failure.upstreamStatus === HttpStatus.FORBIDDEN) {
          await this.afterForbiddenAttempt(failure, providerAccount.id, lastError);
          return;
        }
        void this.providerAccountHealth.disable(
          providerAccount.id,
          providerAccount.credential.kind === "oauth-login"
            ? SIGN_IN_AGAIN_REASON
            : `The upstream refused this key (HTTP ${failure.upstreamStatus ?? "unknown"})`,
          lastError,
        );
        return;
      case "rate_limited":
      case "server_error":
      case "timeout":
      case "connection_error":
      case "stream_interrupted":
        void this.providerAccountHealth.recordFailure(providerAccount.id, lastError);
        await this.cooldowns.startCooldown(providerAccount.id, failure.reason, failure.retryAfter);
        return;
      case "exhausted":
        void this.providerAccountHealth.recordFailure(providerAccount.id, lastError);
        await this.commandBus.execute(
          new MarkProviderAccountExhaustedCommand(
            providerAccount.id,
            exhaustedUntilOf(failure.upstreamResponse?.body ?? ""),
          ),
        );
        void this.readQuota(providerAccount.id);
        return;
    }
  }

  private async attemptWithCredential<Answer>(
    target: AttemptTarget,
    attempt: PreparedAttempt<Answer>,
    meter: UsageMeter,
    credentialOptions: CredentialReadOptions,
  ): Promise<Answer> {
    const account = target.providerAccount;
    meter.attemptStarted(target, attempt.upstreamProtocol, attempt.sentServiceTier);
    const credential = await this.credentialOf(account, credentialOptions);
    meter.credentialUsed(credential.secret);
    try {
      return await attempt.send(credential);
    } catch (error) {
      if (!isRejectedOauthLogin(error, account)) {
        throw error;
      }
      this.logger.warn(
        `The Provider answered 401 to the OAuth Login of Provider Account ${account.id}; ` +
          "refreshing it and trying once more",
      );
      meter.attemptFailed(error);
      meter.attemptStarted(target, attempt.upstreamProtocol, attempt.sentServiceTier);
      const renewed = await asAttemptFailure(() =>
        this.credentials.credentialAfterRejection(account.id, credential, credentialOptions),
      );
      meter.credentialUsed(renewed.secret);
      return await attempt.send(renewed);
    }
  }

  credentialOf(
    account: SnapshotProviderAccount,
    options: CredentialReadOptions = DISABLES_REFUSED_LOGIN,
  ): Promise<ProviderAccountCredential> {
    if (account.credential.kind === "api-key") {
      return Promise.resolve(
        apiKeyCredential(this.cipher.decrypt(account.credential.encryptedKey)),
      );
    }
    return asAttemptFailure(() => this.credentials.credentialOf(account.id, options));
  }

  private async afterForbiddenAttempt(
    failure: AttemptFailedError,
    providerAccountId: string,
    lastError: string,
  ): Promise<void> {
    const refusalCount = await this.cooldowns.countRefusal(providerAccountId);
    if (refusalCount >= DISABLING_REFUSAL_COUNT) {
      await this.cooldowns.resetRefusals(providerAccountId);
      void this.providerAccountHealth.disable(
        providerAccountId,
        `The upstream refused this account's requests ${DISABLING_REFUSAL_COUNT} times in a row (repeated refusals, HTTP 403)`,
        lastError,
      );
      return;
    }
    void this.providerAccountHealth.recordFailure(providerAccountId, lastError);
    await this.cooldowns.startCooldown(providerAccountId, failure.reason, failure.retryAfter);
  }

  private async readQuota(providerAccountId: string): Promise<void> {
    try {
      await this.commandBus.execute(new ReadProviderAccountQuotaCommand(providerAccountId));
    } catch (error) {
      this.logger.warn(
        `Quota of Exhausted Provider Account ${providerAccountId} not read: ${String(error)}`,
      );
    }
  }
}

function isRejectedOauthLogin(
  error: unknown,
  account: SnapshotProviderAccount,
): error is AttemptFailedError {
  return (
    account.credential.kind === "oauth-login" &&
    error instanceof AttemptFailedError &&
    error.upstreamStatus === HttpStatus.UNAUTHORIZED
  );
}

async function asAttemptFailure(
  readCredential: () => Promise<ProviderAccountCredential>,
): Promise<ProviderAccountCredential> {
  try {
    return await readCredential();
  } catch (error) {
    if (error instanceof OauthLoginRefusedError) {
      throw new AttemptFailedError("unauthorized", null, error.message, null, { cause: error });
    }
    if (error instanceof CredentialUnavailableError) {
      throw new AttemptFailedError("connection_error", null, error.message, null, { cause: error });
    }
    throw error;
  }
}

function enabledProviderAccountIdsOf(paths: AttemptPath[]): string[] {
  return paths.flatMap(({ upstreamModel }) =>
    upstreamModel.provider.providerAccounts
      .filter((account) => account.isEnabled)
      .map((account) => account.id),
  );
}
