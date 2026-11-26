import { Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq } from "drizzle-orm";
import { chatEndpointOf } from "@/catalog/schemas/catalog.schema";
import type { Database } from "@/db/schemas/relations";
import { providerAccounts, providers } from "@/db/schemas";
import { SECOND_MS } from "@/libs/models/duration";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import { OauthSignInPolling } from "@/upstream/jobs/oauth-sign-in-polling";
import { unusedConstellationName } from "@/upstream/models/constellation-name";
import { oauthLoginEndpointOf } from "@/upstream/models/oauth-device-grant";
import { type OauthTokens, storedOauthTokens } from "@/upstream/models/provider-account";
import { OauthLoginClient } from "@/upstream/providers/oauth-login-client";
import { OauthRefreshLock } from "@/upstream/providers/oauth-refresh-lock";
import { OauthSignInStore } from "@/upstream/providers/oauth-sign-in-store";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher";
import type { StoredOauthSignIn } from "@/upstream/schemas/oauth-sign-in.schema";
import { PollOauthSignInCommand } from "@/upstream/commands/impl/poll-oauth-sign-in.command";

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
      .select({ endpoints: providers.endpoints, oauthLogin: providers.oauthLogin })
      .from(providers)
      .where(eq(providers.id, signIn.providerId));
    if (!provider?.oauthLogin) {
      return { status: "denied" };
    }

    const endpoint = oauthLoginEndpointOf(provider.oauthLogin, signIn.region, signIn.deviceId);
    if (endpoint === null) {
      return { status: "denied" };
    }
    const poll = await this.oauthLoginClient.pollToken(endpoint, {
      deviceCode: this.keyCipher.decrypt(signIn.encryptedDeviceCode),
      userCode: signIn.userCode,
    });
    switch (poll.kind) {
      case "granted":
        return this.keepLogin(signIn, chatEndpointOf(provider.endpoints)?.baseUrl, poll.tokens);
      case "pending":
        return { status: "pending" };
      case "slow-down":
        return { status: "pending", slowDown: true };
      case "denied":
        return { status: "denied" };
      case "expired":
        return { status: "expired" };
      case "unanswered":
        this.logger.warn(`A sign-in poll got no usable answer (${poll.reason}); polling again`);
        return { status: "pending" };
    }
  }

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

  private async keepLogin(
    signIn: StoredOauthSignIn,
    chatBaseUrl: string | undefined,
    tokens: OauthTokens,
  ): Promise<StoredOauthSignIn["outcome"]> {
    try {
      return await this.storeLogin(signIn, chatBaseUrl, tokens);
    } catch (error) {
      this.logger.error(
        `A sign-in was approved, but its OAuth Login could not be kept: ${failureOf(error)}`,
      );
      return { status: "denied" };
    }
  }

  private async storeLogin(
    signIn: StoredOauthSignIn,
    chatBaseUrl: string | undefined,
    tokens: OauthTokens,
  ): Promise<StoredOauthSignIn["outcome"]> {
    if (signIn.providerAccountId === undefined) {
      return {
        status: "completed",
        providerAccountId: await this.createProviderAccount(signIn, chatBaseUrl, tokens),
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

  private async createProviderAccount(
    signIn: StoredOauthSignIn,
    chatBaseUrl: string | undefined,
    tokens: OauthTokens,
  ): Promise<string> {
    const grantedAt = new Date();
    const name =
      (await this.signedInName(chatBaseUrl, tokens)) ??
      (await this.generateName(signIn.providerId));
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
      const existing = await this.providerAccountCreatedBy(signIn);
      if (existing === undefined) {
        throw new Error("The Provider Account of this sign-in vanished after a conflict");
      }
      return existing;
    }
    await this.snapshot.changed();
    return created.id;
  }

  private async signedInName(
    chatBaseUrl: string | undefined,
    tokens: OauthTokens,
  ): Promise<string | null> {
    const { codexAccount } = tokens;
    if (codexAccount !== undefined) {
      return accountName(codexAccount.email, codexAccount.planType);
    }
    if (chatBaseUrl === undefined) return null;
    const profile = await this.oauthLoginClient.readKimiCodeProfile(
      chatBaseUrl,
      tokens.accessToken,
    );
    return accountName(profile?.nickname?.trim() || profile?.email, profile?.levelName);
  }

  private async generateName(providerId: string): Promise<string> {
    const siblings = await this.db
      .select({ name: providerAccounts.name })
      .from(providerAccounts)
      .where(eq(providerAccounts.providerId, providerId));
    return unusedConstellationName(new Set(siblings.map((sibling) => sibling.name)));
  }
}

function failureOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause instanceof Error ? error.cause.message : error.message;
}

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
