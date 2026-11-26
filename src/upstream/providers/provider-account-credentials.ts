import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { providerAccounts, providers } from "@/db/schemas";
import { cliIdentityHeaders } from "@/upstream/models/cli-identity";
import { codexInferenceHeaders } from "@/upstream/models/codex-cli-identity";
import {
  type OauthLoginEndpoint,
  oauthLoginEndpointOf,
} from "@/upstream/models/oauth-device-grant";
import {
  needsRefresh,
  type OauthLoginLifetime,
  SIGN_IN_AGAIN_REASON,
} from "@/upstream/models/oauth-login";
import {
  apiKeyCredential,
  CredentialUnavailableError,
  OauthLoginRefusedError,
  type ProviderAccountCredential,
} from "@/upstream/models/provider-account-credential";
import { storedOauthTokens } from "@/upstream/models/provider-account";
import { OauthLoginClient } from "./oauth-login-client";
import { OauthRefreshLock } from "./oauth-refresh-lock";
import { ProviderAccountHealth } from "./provider-account-health";
import { ProviderKeyCipher } from "./provider-key-cipher";

interface StoredLogin extends OauthLoginLifetime {
  accessToken: string;
  refreshToken: string;
  endpoint: OauthLoginEndpoint;
  accountId: string | null;
}

export interface CredentialReadOptions {
  disablesRefusedLogin: boolean;
}

const DISABLES_REFUSED_LOGIN: CredentialReadOptions = { disablesRefusedLogin: true };

type StoredCredential =
  | { kind: "api-key"; key: string }
  | { kind: "oauth-login"; login: StoredLogin };

@Injectable()
export class ProviderAccountCredentials {
  private readonly logger = new Logger(ProviderAccountCredentials.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly keyCipher: ProviderKeyCipher,
    private readonly oauthLoginClient: OauthLoginClient,
    private readonly refreshLock: OauthRefreshLock,
    private readonly health: ProviderAccountHealth,
  ) {}

  async credentialOf(
    providerAccountId: string,
    options: CredentialReadOptions = DISABLES_REFUSED_LOGIN,
  ): Promise<ProviderAccountCredential> {
    const stored = await this.read(providerAccountId);
    if (stored.kind === "api-key") {
      return apiKeyCredential(stored.key);
    }
    const { login } = stored;
    if (!needsRefresh(login, new Date())) {
      return loginCredential(login);
    }
    try {
      return await this.refreshed(
        providerAccountId,
        (current) => needsRefresh(current, new Date()),
        options,
      );
    } catch (error) {
      if (error instanceof CredentialUnavailableError && login.expiresAt > new Date()) {
        this.logger.warn(
          `OAuth Login of Provider Account ${providerAccountId} not refreshed, ` +
            `using it while it lasts: ${error.message}`,
        );
        return loginCredential(login);
      }
      throw error;
    }
  }

  credentialAfterRejection(
    providerAccountId: string,
    rejected: ProviderAccountCredential,
    options: CredentialReadOptions = DISABLES_REFUSED_LOGIN,
  ): Promise<ProviderAccountCredential> {
    return this.refreshed(
      providerAccountId,
      (current) => current.accessToken === rejected.secret,
      options,
    );
  }

  private refreshed(
    providerAccountId: string,
    isStale: (login: StoredLogin) => boolean,
    options: CredentialReadOptions,
  ): Promise<ProviderAccountCredential> {
    return this.refreshLock.run(providerAccountId, async () => {
      const stored = await this.read(providerAccountId);
      if (stored.kind !== "oauth-login") {
        throw new CredentialUnavailableError("Provider Account holds no OAuth Login");
      }
      if (!isStale(stored.login)) {
        return loginCredential(stored.login);
      }
      return loginCredential(await this.refresh(providerAccountId, stored.login, options));
    });
  }

  private async refresh(
    providerAccountId: string,
    login: StoredLogin,
    { disablesRefusedLogin }: CredentialReadOptions,
  ): Promise<StoredLogin> {
    const grantedAt = new Date();
    const refresh = await this.oauthLoginClient.refreshTokens(login.endpoint, login.refreshToken);
    switch (refresh.kind) {
      case "refreshed": {
        const columns = storedOauthTokens(this.keyCipher, refresh.tokens, grantedAt);
        await this.db
          .update(providerAccounts)
          .set(columns)
          .where(eq(providerAccounts.id, providerAccountId));
        return {
          accessToken: refresh.tokens.accessToken,
          refreshToken: refresh.tokens.refreshToken,
          grantedAt,
          expiresAt: columns.oauthExpiresAt,
          endpoint: login.endpoint,
          accountId: refresh.tokens.codexAccount?.accountId ?? login.accountId,
        };
      }
      case "refused":
        if (disablesRefusedLogin) {
          await this.health.disable(
            providerAccountId,
            SIGN_IN_AGAIN_REASON,
            `unauthorized: the auth host refused to refresh the OAuth Login (${refresh.reason})`,
          );
        }
        throw new OauthLoginRefusedError(
          `The auth host refused to refresh the OAuth Login (${refresh.reason})`,
        );
      case "unanswered":
        throw new CredentialUnavailableError(
          `The auth host did not refresh the OAuth Login (${refresh.reason})`,
        );
    }
  }

  private async read(providerAccountId: string): Promise<StoredCredential> {
    const [account] = await this.db
      .select({
        credentialKind: providerAccounts.credentialKind,
        encryptedKey: providerAccounts.encryptedKey,
        encryptedAccessToken: providerAccounts.oauthEncryptedAccessToken,
        encryptedRefreshToken: providerAccounts.oauthEncryptedRefreshToken,
        grantedAt: providerAccounts.oauthGrantedAt,
        expiresAt: providerAccounts.oauthExpiresAt,
        region: providerAccounts.oauthRegion,
        deviceId: providerAccounts.oauthDeviceId,
        accountId: providerAccounts.oauthAccountId,
        oauthLogin: providers.oauthLogin,
      })
      .from(providerAccounts)
      .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
      .where(eq(providerAccounts.id, providerAccountId));
    if (!account) {
      throw new NotFoundException("Provider Account not found");
    }
    if (account.credentialKind === "api-key") {
      if (account.encryptedKey === null) {
        throw new CredentialUnavailableError("Provider Account holds no credential");
      }
      return { kind: "api-key", key: this.keyCipher.decrypt(account.encryptedKey) };
    }
    const { encryptedAccessToken, encryptedRefreshToken, expiresAt, deviceId } = account;
    if (
      encryptedAccessToken === null ||
      encryptedRefreshToken === null ||
      expiresAt === null ||
      deviceId === null
    ) {
      throw new CredentialUnavailableError("Provider Account holds no credential");
    }
    if (account.oauthLogin === null) {
      throw new CredentialUnavailableError("The Provider no longer offers OAuth Login");
    }
    const endpoint = oauthLoginEndpointOf(account.oauthLogin, account.region, deviceId);
    if (endpoint === null) {
      throw new CredentialUnavailableError("The OAuth Login names no region of the Provider");
    }
    return {
      kind: "oauth-login",
      login: {
        accessToken: this.keyCipher.decrypt(encryptedAccessToken),
        refreshToken: this.keyCipher.decrypt(encryptedRefreshToken),
        grantedAt: account.grantedAt,
        expiresAt,
        endpoint,
        accountId: account.accountId,
      },
    };
  }
}

function loginCredential({
  accessToken,
  endpoint,
  accountId,
}: StoredLogin): ProviderAccountCredential {
  return { secret: accessToken, identityHeaders: identityHeadersOf(endpoint, accountId) };
}

function identityHeadersOf(
  endpoint: OauthLoginEndpoint,
  accountId: string | null,
): Record<string, string> {
  switch (endpoint.flow) {
    case "kimi-code":
      return cliIdentityHeaders(endpoint.identity);
    case "openai-codex":
      return codexInferenceHeaders({ cliVersion: endpoint.cliVersion, accountId });
  }
}
