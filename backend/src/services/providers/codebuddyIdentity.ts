import { getProviderRegistryEntry } from "./providerCatalog";

const CODEBUDDY_PROVIDERS = new Set(["codebuddy-intl-cli"]);

export function isCodebuddyProvider(provider: string): boolean {
  return CODEBUDDY_PROVIDERS.has(provider);
}

function oauthConfig(provider: string): Record<string, unknown> {
  return (getProviderRegistryEntry(provider)?.oauth as Record<string, unknown> | undefined) || {};
}

export function codebuddyAccountsUrl(provider: string): string | null {
  const base = typeof oauthConfig(provider).baseUrl === "string" ? (oauthConfig(provider).baseUrl as string) : null;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/v2/accounts`;
}

function codebuddyDomain(provider: string): string | null {
  const base = typeof oauthConfig(provider).baseUrl === "string" ? (oauthConfig(provider).baseUrl as string) : null;
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "").split("/")[0] || null;
  }
}

export interface CodebuddyAccount {
  uid: string;
  nickname: string;
  enterpriseName?: string;
  enterpriseId?: string;
}

// Fetch the logged-in account identity from GET /v2/accounts with the bearer
// access token. Mirrors the CodeBuddy Code CLI's WxAuthenticationProvider.fetchAccounts.
export async function fetchCodebuddyAccount(provider: string, accessToken: string): Promise<CodebuddyAccount | null> {
  const url = codebuddyAccountsUrl(provider);
  const domain = codebuddyDomain(provider);
  if (!url || !accessToken) return null;
  const config = oauthConfig(provider);
  const userAgent = typeof config.userAgent === "string" ? (config.userAgent as string) : "IDE/2.63.2 CodeBuddy/2.63.2";
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
        "X-Requested-With": "XMLHttpRequest",
        "X-Product": "SaaS",
        ...(domain ? { "X-Domain": domain } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, any>;
    const accounts = Array.isArray(body?.data?.accounts)
      ? body.data.accounts
      : Array.isArray(body?.data)
        ? body.data
        : [];
    const account = accounts.find((item: Record<string, any>) => item?.lastLogin) || accounts[0];
    const uid = account?.uid;
    if (!uid) return null;
    return {
      uid: String(uid),
      nickname: typeof account.nickname === "string" ? account.nickname : "",
      enterpriseName: typeof account.enterpriseName === "string" ? account.enterpriseName : undefined,
      enterpriseId: typeof account.enterpriseId === "string" ? account.enterpriseId : undefined,
    };
  } catch {
    return null;
  }
}
