import { Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers } from "@/db/schemas/index.js";
import { SECOND_MS } from "@/libs/models/duration.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { OauthSignInPolling } from "../../jobs/oauth-sign-in-polling.js";
import { unusedConstellationName } from "../../models/constellation-name.js";
import { oauthLoginEndpointOf } from "../../models/oauth-device-grant.js";
import { type OauthTokens, storedOauthTokens } from "../../models/provider-account.js";
import { OauthLoginClient } from "../../providers/oauth-login-client.js";
import { OauthRefreshLock } from "../../providers/oauth-refresh-lock.js";
import { OauthSignInStore } from "../../providers/oauth-sign-in-store.js";
import { ProviderKeyCipher } from "../../providers/provider-key-cipher.js";
import type { StoredOauthSignIn } from "../../schemas/oauth-sign-in.schema.js";
import { PollOauthSignInCommand } from "../impl/poll-oauth-sign-in.command.js";

/** RFC 8628: `slow_down` lengthens the wait between polls by this much, for the rest of the sign-in. */
const SLOW_DOWN_SECONDS = 5;

@CommandHandler(PollOauthSignInCommand)
export class PollOauthSignInHandler implements ICommandHandler<PollOauthSignInCommand> {
  private readonly logger = new Logger(PollOauthSignInHandler.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly oauthLoginClient: OauthLoginClient,
    private readonly signIns: OauthSignInStore,
    private readonly polling: OauthSignInPolling,
    private readonly keyCipher: ProviderKeyCipher,
    private readonly refreshLock: OauthRefreshLock,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ signInId }: PollOauthSignInCommand): Promise<void> {
    const signIn = await this.signIns.find(signInId);
    if (signIn?.outcome.status !== "pending") {
      return;
    }
    const outcome = await this.poll(signIn);
    const polled: StoredOauthSignIn = {
      ...signIn,
      outcome,
      pollIntervalSeconds: signIn.pollIntervalSeconds + (outcome.slowDown ? SLOW_DOWN_SECONDS : 0),
    };
    await this.signIns.save(signInId, polled, new Date());
    if (outcome.status === "pending") {
      await this.polling.pollIn(signInId, polled.pollIntervalSeconds * SECOND_MS);
    }
  }

  /** What the sign-in has come to, after asking the auth host once. */
  private async poll(
    signIn: StoredOauthSignIn,
  ): Promise<StoredOauthSignIn["outcome"] & { slowDown?: boolean }> {
    const createdProviderAccountId = await this.providerAccountCreatedBy(signIn);
    if (createdProviderAccountId !== undefined) {
      return { status: "completed", providerAccountId: createdProviderAccountId };
    }
    if (Date.now() >= signIn.expiresAt) {
      return { status: "expired" };
    }
    const [provider] = await this.db
      .select({ baseUrl: providers.baseUrl, oauthLogin: providers.oauthLogin })
      .from(providers)
      .where(eq(providers.id, signIn.providerId));
    if (!provider?.oauthLogin) {
      // The Provider was deleted, or stopped offering OAuth Login, mid sign-in.
      return { status: "denied" };
    }

    const endpoint = oauthLoginEndpointOf(provider.oauthLogin, signIn.region, signIn.deviceId);
    if (endpoint === null) {
      // An operator changed the Provider's sign-in to one with regions mid sign-in.
      return { status: "denied" };
    }
    const poll = await this.oauthLoginClient.pollToken(endpoint, {
      deviceCode: this.keyCipher.decrypt(signIn.encryptedDeviceCode),
      userCode: signIn.userCode,
    });
    switch (poll.kind) {
      case "granted":
        return this.keepLogin(signIn, provider.baseUrl, poll.tokens);
      case "pending":
        return { status: "pending" };
      case "slow-down":
        return { status: "pending", slowDown: true };
      case "denied":
        return { status: "denied" };
      case "expired":
        return { status: "expired" };
      case "unanswered":
        // The code's own expiry ends a sign-in whose auth host never answers.
        this.logger.warn(`A sign-in poll got no usable answer (${poll.reason}); polling again`);
        return { status: "pending" };
    }
  }

  /**
   * The Provider Account an earlier run of this poll created without getting
   * to record that the sign-in completed (Redis failed, so the queue runs
   * the poll again). The grant spent the device code, so the auth host would
   * no longer say; the device id, generated for this sign-in, does.
   */
  private async providerAccountCreatedBy(signIn: StoredOauthSignIn): Promise<string | undefined> {
    if (signIn.providerAccountId !== undefined) {
      return undefined;
    }
    const [created] = await this.db
      .select({ id: providerAccounts.id })
      .from(providerAccounts)
      .where(
        and(
          eq(providerAccounts.providerId, signIn.providerId),
          eq(providerAccounts.oauthDeviceId, signIn.deviceId),
        ),
      );
    return created?.id;
  }

  /**
   * Stores the granted OAuth Login on the Provider Account signed in again,
   * or on a new one. The grant spent the device code, so no later poll can
   * make up for a login that could not be stored: the sign-in ends here,
   * denied, and the User starts another. Either write is one statement, so
   * a failure leaves no account, and no login, half made.
   */
  private async keepLogin(
    signIn: StoredOauthSignIn,
    baseUrl: string,
    tokens: OauthTokens,
  ): Promise<StoredOauthSignIn["outcome"]> {
    try {
      return await this.storeLogin(signIn, baseUrl, tokens);
    } catch (error) {
      this.logger.error(
        `A sign-in was approved, but its OAuth Login could not be kept: ${failureOf(error)}`,
      );
      return { status: "denied" };
    }
  }

  private async storeLogin(
    signIn: StoredOauthSignIn,
    baseUrl: string,
    tokens: OauthTokens,
  ): Promise<StoredOauthSignIn["outcome"]> {
    if (signIn.providerAccountId === undefined) {
      return {
        status: "completed",
        providerAccountId: await this.createProviderAccount(signIn, baseUrl, tokens),
      };
    }
    if (!(await this.replaceLogin(signIn.providerAccountId, signIn, tokens))) {
      this.logger.warn(
        `Provider Account ${signIn.providerAccountId} was deleted before its sign-in was approved`,
      );
      return { status: "denied" };
    }
    return { status: "completed", providerAccountId: signIn.providerAccountId };
  }

  /**
   * Signing in again: the granted OAuth Login replaces the Provider
   * Account's, which is enabled again. Its name, priority and device id
   * stay, and so do its Usage Logs and Quota Meters. Under the refresh lock,
   * so a refresh of the old login in progress can't overwrite the new one.
   * False when the account no longer exists.
   */
  private async replaceLogin(
    providerAccountId: string,
    signIn: StoredOauthSignIn,
    tokens: OauthTokens,
  ): Promise<boolean> {
    const grantedAt = new Date();
    const replaced = await this.refreshLock.run(providerAccountId, () =>
      this.db
        .update(providerAccounts)
        .set({
          ...storedOauthTokens(this.keyCipher, tokens, grantedAt),
          oauthRegion: signIn.region,
          isEnabled: true,
          disabledReason: null,
        })
        .where(eq(providerAccounts.id, providerAccountId))
        .returning({ id: providerAccounts.id }),
    );
    if (replaced.length === 0) {
      return false;
    }
    await this.snapshot.changed();
    return true;
  }

  /** The Provider Account that holds the granted OAuth Login. Returns its id. */
  private async createProviderAccount(
    signIn: StoredOauthSignIn,
    baseUrl: string,
    tokens: OauthTokens,
  ): Promise<string> {
    const grantedAt = new Date();
    const name =
      (await this.signedInName(baseUrl, tokens)) ?? (await this.generateName(signIn.providerId));
    const [created] = await this.db
      .insert(providerAccounts)
      .values({
        providerId: signIn.providerId,
        name,
        credentialKind: "oauth-login",
        ...storedOauthTokens(this.keyCipher, tokens, grantedAt),
        oauthRegion: signIn.region,
        oauthDeviceId: signIn.deviceId,
      })
      .onConflictDoNothing()
      .returning({ id: providerAccounts.id });
    if (created === undefined) {
      // A concurrent poll of this sign-in created the account first.
      const existing = await this.providerAccountCreatedBy(signIn);
      if (existing === undefined) {
        throw new Error("The Provider Account of this sign-in vanished after a conflict");
      }
      return existing;
    }
    await this.snapshot.changed();
    return created.id;
  }

  /**
   * Who signed in, as the Provider tells: OpenAI Codex in the id_token it
   * granted, Kimi Code in its profile. Null when it doesn't.
   */
  private async signedInName(baseUrl: string, tokens: OauthTokens): Promise<string | null> {
    const { codexAccount } = tokens;
    if (codexAccount !== undefined) {
      return accountName(codexAccount.email, codexAccount.planType);
    }
    const profile = await this.oauthLoginClient.readKimiCodeProfile(baseUrl, tokens.accessToken);
    return accountName(profile?.nickname?.trim() || profile?.email, profile?.levelName);
  }

  /** A constellation name no other account of the Provider uses, when the Provider tells no name. */
  private async generateName(providerId: string): Promise<string> {
    const siblings = await this.db
      .select({ name: providerAccounts.name })
      .from(providerAccounts)
      .where(eq(providerAccounts.providerId, providerId));
    return unusedConstellationName(new Set(siblings.map((sibling) => sibling.name)));
  }
}

/**
 * Why a write failed, without the statement: a failed query's own message
 * quotes its parameters, which here include the tokens' ciphertext.
 */
function failureOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause instanceof Error ? error.cause.message : error.message;
}

/** A name that tells accounts apart: who signed in and on which plan, such as `Ada (Allegretto)`. */
function accountName(
  who: string | null | undefined,
  plan: string | null | undefined,
): string | null {
  const trimmedWho = who?.trim();
  if (!trimmedWho) {
    return null;
  }
  const trimmedPlan = plan?.trim();
  return trimmedPlan ? `${trimmedWho} (${trimmedPlan})` : trimmedWho;
}
