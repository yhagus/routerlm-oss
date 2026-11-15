import { randomUUID } from "node:crypto";
import { BadGatewayException, ConflictException, NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { type ProviderOauthLogin, providers } from "@/db/schemas/index.js";
import { OauthSignInPolling } from "../../jobs/oauth-sign-in-polling.js";
import type { OauthSignIn } from "../../models/oauth-sign-in.js";
import {
  type DeviceAuthorization,
  OauthLoginClient,
  OauthLoginError,
  type OauthLoginEndpoint,
  oauthLoginEndpointOf,
} from "../../providers/oauth-login-client.js";
import { OauthSignInStore } from "../../providers/oauth-sign-in-store.js";
import { ProviderKeyCipher } from "../../providers/provider-key-cipher.js";
import { StartOauthSignInCommand } from "../impl/start-oauth-sign-in.command.js";

const SECOND_MS = 1000;

@CommandHandler(StartOauthSignInCommand)
export class StartOauthSignInHandler implements ICommandHandler<StartOauthSignInCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly oauthLoginClient: OauthLoginClient,
    private readonly signIns: OauthSignInStore,
    private readonly polling: OauthSignInPolling,
    private readonly keyCipher: ProviderKeyCipher,
  ) {}

  async execute({ newSignIn }: StartOauthSignInCommand): Promise<OauthSignIn> {
    const { providerId, region } = newSignIn;
    const oauthLogin = await this.oauthLoginOf(providerId);
    // Generated once per Provider Account: the account the sign-in creates keeps it.
    const deviceId = randomUUID().replaceAll("-", "");
    const authorization = await this.authorizeDevice(
      oauthLoginEndpointOf(oauthLogin, region, deviceId),
    );

    const signInId = randomUUID();
    const startedAt = new Date();
    const expiresAt = startedAt.getTime() + authorization.expiresInSeconds * SECOND_MS;
    await this.signIns.save(
      signInId,
      {
        providerId,
        region,
        deviceId,
        encryptedDeviceCode: this.keyCipher.encrypt(authorization.deviceCode),
        userCode: authorization.userCode,
        verificationUri: authorization.verificationUri,
        verificationUriComplete: authorization.verificationUriComplete,
        expiresAt,
        pollIntervalSeconds: authorization.pollIntervalSeconds,
        outcome: { status: "pending" },
      },
      startedAt,
    );
    await this.polling.pollIn(signInId, authorization.pollIntervalSeconds * SECOND_MS);

    return {
      id: signInId,
      status: "pending",
      userCode: authorization.userCode,
      verificationUri: authorization.verificationUri,
      verificationUriComplete: authorization.verificationUriComplete,
      expiresAt: new Date(expiresAt),
    };
  }

  private async oauthLoginOf(providerId: string): Promise<ProviderOauthLogin> {
    const [provider] = await this.db
      .select({ name: providers.name, oauthLogin: providers.oauthLogin })
      .from(providers)
      .where(eq(providers.id, providerId));
    if (!provider) {
      throw new NotFoundException("Provider not found");
    }
    if (provider.oauthLogin === null) {
      throw new ConflictException(`${provider.name} offers no OAuth Login`);
    }
    return provider.oauthLogin;
  }

  private async authorizeDevice(endpoint: OauthLoginEndpoint): Promise<DeviceAuthorization> {
    try {
      return await this.oauthLoginClient.authorizeDevice(endpoint);
    } catch (error) {
      if (error instanceof OauthLoginError) {
        throw new BadGatewayException(error.message, { cause: error });
      }
      throw error;
    }
  }
}
