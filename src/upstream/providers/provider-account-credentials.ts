import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers } from "@/db/schemas/index.js";
import { cliIdentityHeaders } from "../models/cli-identity.js";
import { codexInferenceHeaders } from "../models/codex-cli-identity.js";
import { type OauthLoginEndpoint, oauthLoginEndpointOf } from "../models/oauth-device-grant.js";
import {
  needsRefresh,
  type OauthLoginLifetime,
  SIGN_IN_AGAIN_REASON,
} from "../models/oauth-login.js";
import {
  apiKeyCredential,
  CredentialUnavailableError,
  OauthLoginRefusedError,
  type ProviderAccountCredential,
} from "../models/provider-account-credential.js";
import { storedOauthTokens } from "../models/provider-account.js";
import { OauthLoginClient } from "./oauth-login-client.js";
import { OauthRefreshLock } from "./oauth-refresh-lock.js";
import { ProviderAccountHealth } from "./provider-account-health.js";
import { ProviderKeyCipher } from "./provider-key-cipher.js";

/** A Provider Account's OAuth Login as stored, decrypted, with the auth host that refreshes it. */
interface StoredLogin extends OauthLoginLifetime {
  accessToken: string;
  refreshToken: string;
  endpoint: OauthLoginEndpoint;
  /** OpenAI Codex only: the ChatGPT account the login calls for. */
  accountId: string | null;
}

/** What reading a credential may do to its Provider Account. */
export interface CredentialReadOptions {
  /**
   * Whether an OAuth Login the auth host refuses to refresh disables the
   * account. False for a Probe, which observes the account and never changes it.
   */
  disablesRefusedLogin: boolean;
}

const DISABLES_REFUSED_LOGIN: CredentialReadOptions = { disablesRefusedLogin: true };

type StoredCredential =
  | { kind: "api-key"; key: string }
  | { kind: "oauth-login"; login: StoredLogin };

/**
 * The credential a call to a Provider sends for a Provider Account: its API
 * key, or its OAuth Login's access token, which is refreshed here when it is
 * about to run out. There is no background refresh: a login is renewed only
 * by the call that needs it.
 */
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

  /**
   * Throws NotFoundException for an unknown account, OauthLoginRefusedError
   * when the Provider refuses to renew its OAuth Login, and
   * CredentialUnavailableError when a login that has run out can't be renewed
   * for now.
   */
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

  /**
   * The credential to try once more with after the Provider answered 401 to
   * `rejected`: the OAuth Login, refreshed whatever its age. Throws as
   * `credentialOf` does.
   */
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

  /**
   * Refreshes the login under the Provider Account's lock, unless another
   * process did meanwhile: the stored login is read again once the lock is
   * held, and refreshed only if it is still `isStale`.
   */
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

  /** Asks the auth host for new tokens and stores them in place of the old ones. */
  private async refresh(
    providerAccountId: string,
    login: StoredLogin,
    { disablesRefusedLogin }: CredentialReadOptions,
  ): Promise<StoredLogin> {
    // Before the request, so the stored expiry is never later than the real one.
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
      // An operator took the OAuth data off the Provider: nothing says how to present or refresh the login.
      throw new CredentialUnavailableError("The Provider no longer offers OAuth Login");
    }
    const endpoint = oauthLoginEndpointOf(account.oauthLogin, account.region, deviceId);
    if (endpoint === null) {
      // Signed in without a region, but the Provider now signs in with regions.
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

/** How a call made with the login presents itself as the Provider's CLI (ADR 0012, 0013). */
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
