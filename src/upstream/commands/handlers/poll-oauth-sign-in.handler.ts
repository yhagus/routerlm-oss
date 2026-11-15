import { Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { OauthSignInPolling } from "../../jobs/oauth-sign-in-polling.js";
import { unusedConstellationName } from "../../models/constellation-name.js";
import { type OauthTokens, storedOauthTokens } from "../../models/provider-account.js";
import {
  OauthLoginClient,
  type OauthProfile,
  oauthLoginEndpointOf,
} from "../../providers/oauth-login-client.js";
import { OauthRefreshLock } from "../../providers/oauth-refresh-lock.js";
import { OauthSignInStore } from "../../providers/oauth-sign-in-store.js";
import { ProviderKeyCipher } from "../../providers/provider-key-cipher.js";
import type { StoredOauthSignIn } from "../../schemas/oauth-sign-in.schema.js";
import { PollOauthSignInCommand } from "../impl/poll-oauth-sign-in.command.js";

const SECOND_MS = 1000;
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

    const poll = await this.oauthLoginClient.pollToken(
      oauthLoginEndpointOf(provider.oauthLogin, signIn.region, signIn.deviceId),
      this.keyCipher.decrypt(signIn.encryptedDeviceCode),
    );
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

  /** Stores the granted OAuth Login on the Provider Account signed in again, or on a new one. */
  private async keepLogin(
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
    const profile = await this.oauthLoginClient.readProfile(baseUrl, tokens.accessToken);
    const name = profileName(profile) ?? (await this.generateName(signIn.providerId));
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
      .returning({ id: providerAccounts.id });
    await this.snapshot.changed();
    return created.id;
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

/** A name that tells accounts apart: who signed in and on which plan, such as `Ada (Allegretto)`. */
function profileName(profile: OauthProfile | null): string | null {
  const who = profile?.nickname?.trim() || profile?.email?.trim();
  if (!who) {
    return null;
  }
  const levelName = profile?.levelName?.trim();
  return levelName ? `${who} (${levelName})` : who;
}
