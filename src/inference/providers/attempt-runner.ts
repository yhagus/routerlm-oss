import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { ReadProviderAccountQuotaCommand } from "@/quota-meters/commands/impl/read-provider-account-quota.command.js";
import type { SnapshotProviderAccount } from "@/snapshot/models/snapshot.js";
import { MarkProviderAccountExhaustedCommand } from "@/upstream/commands/impl/mark-provider-account-exhausted.command.js";
import { SIGN_IN_AGAIN_REASON } from "@/upstream/models/oauth-login.js";
import {
  apiKeyCredential,
  CredentialUnavailableError,
  OauthLoginRefusedError,
  type ProviderAccountCredential,
} from "@/upstream/models/provider-account-credential.js";
import { CooldownStore } from "@/upstream/providers/cooldown-store.js";
import {
  type CredentialReadOptions,
  ProviderAccountCredentials,
} from "@/upstream/providers/provider-account-credentials.js";
import { ProviderAccountHealth } from "@/upstream/providers/provider-account-health.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import { AttemptFailedError, exhaustionError, gatewayErrorFor } from "../models/attempt-failure.js";
import { exhaustedUntilOf } from "../models/quota-exhausted-error.js";
import { type AttemptPath, type AttemptTarget, attemptTargets } from "../models/route-selection.js";
import type { Destination } from "../models/destination.js";
import type { SentServiceTier } from "../models/service-tier.js";
import type { UsageMeter } from "../models/usage-meter.js";

/** Spec "Fallback": at most this many upstream calls per client request. */
export const MAX_ATTEMPTS_PER_REQUEST = 5;

/** ADR 0023: this many 403s in a row, with no success between, disable the Provider Account. */
const DISABLING_REFUSAL_COUNT = 3;

const DISABLES_REFUSED_LOGIN: CredentialReadOptions = { disablesRefusedLogin: true };
/** A Probe observes its Provider Account and never changes it (GLOSSARY "Probe"). */
const LEAVES_REFUSED_LOGIN_ENABLED: CredentialReadOptions = { disablesRefusedLogin: false };

/**
 * One Attempt as a Kind makes it: the Service Tier it asks for (null for a
 * Kind without tiers), and the upstream call itself, given the Provider
 * Account's credential. `send` throws AttemptFailedError while Fallback is
 * still possible.
 */
export interface PreparedAttempt<Answer> {
  sentServiceTier: SentServiceTier | null;
  send(credential: ProviderAccountCredential): Promise<Answer>;
}

/**
 * The Attempt and Fallback loop every Model Kind shares (spec "Fallback"):
 * tries the targets of `paths` in order, skipping Provider Accounts in
 * Cooldown, until one Attempt answers; keeps each account's health, Cooldown
 * and Exhausted state as Attempts fail. What an Attempt sends and how its
 * answer is read is the Kind's business, in `prepare`.
 *
 * Every routing side effect an Attempt can have, and where it happens. A path
 * that must leave routing state alone (a Probe, `probeAnswer`) avoids all of them:
 * - refusal counter reset on success: the Fallback loop in `firstAnswer`;
 * - disable on 401: `afterFailedAttempt`;
 * - Cooldown and Exhausted: `afterFailedAttempt`;
 * - 403 refusal counter, then Cooldown or disable (ADR 0023): `afterForbiddenAttempt`;
 * - quota read: `readQuota`;
 * - disable of an OAuth Login whose refresh is refused: credential reading in
 *   `ProviderAccountCredentials`, unless `CredentialReadOptions.disablesRefusedLogin` is off.
 */
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

  /**
   * The answer to a request to `destination`: its Probe's one Attempt, or
   * the first answer Fallback gets over its paths.
   */
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

  /**
   * The first answer an Attempt gets. Throws the GatewayError the client is
   * told once Fallback has run out, or at once for a request the upstream
   * refused as invalid: another Provider Account would refuse it too.
   */
  async firstAnswer<Answer>(
    paths: AttemptPath[],
    meter: UsageMeter,
    prepare: (target: AttemptTarget) => PreparedAttempt<Answer>,
  ): Promise<Answer> {
    // Accounts in Cooldown when the request arrived, plus the ones that fail during it.
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
      // Recorded once, even when the account comes up again on a later Route.
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

  /**
   * A Probe's one Attempt (GLOSSARY "Probe"), made even when the Provider
   * Account is in Cooldown or Exhausted. It observes the account and never
   * changes it: a failure starts no Cooldown, marks nothing Exhausted,
   * disables nothing and counts no refusal, and a success clears nothing.
   * An OAuth Login answered with 401 is still refreshed and tried once more.
   */
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

  /**
   * What a failed Attempt does to its Provider Account (spec "Fallback"):
   * 401 disables it until an operator re-enables it or, for an OAuth
   * Login, signs in again; repeated 403s do too, one 403, rate limits, 5xx,
   * timeouts and connection errors put it in Cooldown; running out of quota
   * makes it Exhausted; a bad request says nothing about the account. The
   * database writes and the quota reading are not awaited. Also called for
   * a stream that fails after its first event, where Fallback is over.
   */
  async afterFailedAttempt(
    failure: AttemptFailedError,
    { route, upstreamModel, providerAccount }: AttemptTarget,
  ): Promise<void> {
    const path = route ? `Route ${route.id}` : `Upstream Model ${upstreamModel.id} (direct)`;
    // Upstream error text stays in this log line and the dashboard, never in the reply.
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
        // Until the reset the refusal names; for a short while when it names none.
        await this.commandBus.execute(
          new MarkProviderAccountExhaustedCommand(
            providerAccount.id,
            exhaustedUntilOf(failure.upstreamResponse?.body ?? ""),
          ),
        );
        // Started only now, so the end a reading sets replaces the refusal's.
        void this.readQuota(providerAccount.id);
        return;
    }
  }

  /**
   * One Attempt with the Provider Account's credential. An OAuth Login the
   * upstream answers with 401 is refreshed once and tried once more (spec
   * "OAuth Login"), as a second Attempt on the same Provider Account.
   */
  private async attemptWithCredential<Answer>(
    target: AttemptTarget,
    attempt: PreparedAttempt<Answer>,
    meter: UsageMeter,
    credentialOptions: CredentialReadOptions,
  ): Promise<Answer> {
    const account = target.providerAccount;
    meter.attemptStarted(target, attempt.sentServiceTier);
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
      meter.attemptStarted(target, attempt.sentServiceTier);
      const renewed = await asAttemptFailure(() =>
        this.credentials.credentialAfterRejection(account.id, credential, credentialOptions),
      );
      meter.credentialUsed(renewed.secret);
      return await attempt.send(renewed);
    }
  }

  /**
   * An API key comes from the snapshot, as ever. An OAuth Login is read where
   * it is stored, and refreshed first when it is about to run out. Also used
   * by a Video Job's poll, which makes its one call outside the Fallback loop.
   */
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

  /**
   * A 403 may be tied to one request, so it starts a Cooldown like a 5xx; the
   * third in a row with no success between disables the account (ADR 0023).
   */
  private async afterForbiddenAttempt(
    failure: AttemptFailedError,
    providerAccountId: string,
    lastError: string,
  ): Promise<void> {
    const refusalCount = await this.cooldowns.countRefusal(providerAccountId);
    if (refusalCount >= DISABLING_REFUSAL_COUNT) {
      // An operator who re-enables the account starts the count again.
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

  /** A failed reading, or a Provider with no quota reader, leaves the short Exhausted state. */
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

/** Whether the upstream answered 401 to an OAuth Login, which one refresh may cure. */
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

/**
 * Reads an OAuth Login's credential, turning what keeps it from being read
 * into a failed Attempt, so Fallback moves on: a login the Provider refuses
 * counts as unauthorized, one that can't be refreshed for now as a
 * connection error.
 */
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

/** The Provider Accounts Fallback may try, unless they are in Cooldown. */
function enabledProviderAccountIdsOf(paths: AttemptPath[]): string[] {
  return paths.flatMap(({ upstreamModel }) =>
    upstreamModel.provider.providerAccounts
      .filter((account) => account.isEnabled)
      .map((account) => account.id),
  );
}
