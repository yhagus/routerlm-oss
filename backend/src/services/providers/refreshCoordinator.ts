import type { Runtime } from "../../runtime";
import type { ProviderConnection, Repositories } from "../../db/repositories";
import { getV2Executor } from "../chat/executors";
import { connectionCredentials, connectionProxyOptions } from "../chat/credentials";
import { shouldRefreshCredentials } from "./oauth/oauthCredentialManager.ts";
import { refreshProviderToken } from "./tokenRefresh";
import { isPlainObject } from "../common/objects";

// The refresh coordinator owns every Credentials refresh for a stored
// Connection. It holds one in-flight refresh per Connection id, so a burst
// of requests on one Connection sends one refresh to the Provider. Providers
// that rotate refresh tokens then see each refresh token only once.
//
// Unsaved or synthetic Credentials do not have a Connection id. They keep
// using withCredentialRefreshLock in the OAuth credential manager.

export type RefreshFunction = (
  credentials: Record<string, any>,
  connection: ProviderConnection,
  context: { log: any; proxyOptions: Record<string, unknown> },
) => Promise<Record<string, any> | null | undefined>;

export interface RefreshOptions {
  // The access token that the Provider rejected (401/403). When it is set,
  // the coordinator refreshes only if the stored token is still this token.
  // When it is not set, the coordinator refreshes only if the stored token
  // is near expiry.
  failedAccessToken?: string | null;
  // Defaults to the Executor's refreshCredentials for the Connection's Provider.
  refresh?: RefreshFunction;
  // Proxy for the refresh call. Defaults to the Connection's own proxy.
  proxyOptions?: Record<string, unknown>;
  log?: any;
}

export interface RefreshResult {
  // True when the Provider issued new Credentials. False when the stored
  // Credentials were already current.
  refreshed: boolean;
  // Executor Credentials for the Connection after the refresh.
  credentials: Record<string, any>;
}

type RefreshRuntime = Pick<Runtime, "repos">;

const inFlightByRepos = new WeakMap<Repositories, Map<string, Promise<RefreshResult | null>>>();

function inFlight(repos: Repositories): Map<string, Promise<RefreshResult | null>> {
  let flights = inFlightByRepos.get(repos);
  if (!flights) {
    flights = new Map();
    inFlightByRepos.set(repos, flights);
  }
  return flights;
}

// Returns null when the Connection does not exist, has no refresh function,
// or the Provider refresh fails. The request path makes one attempt only.
export function refreshConnectionCredentials(runtime: RefreshRuntime, connectionId: string, options: RefreshOptions = {}): Promise<RefreshResult | null> {
  const flights = inFlight(runtime.repos);
  const existing = flights.get(connectionId);
  if (existing) return existing;

  const current = runtime.repos.providers.get(connectionId);
  if (!current) return Promise.resolve(null);
  const credentials = connectionCredentials(runtime, current);
  if (!isStale(current, credentials, options)) return Promise.resolve({ refreshed: false, credentials });

  const refresh = options.refresh ?? executorRefresh(current.provider);
  if (!refresh) return Promise.resolve(null);

  const flight = runRefresh(runtime, current, credentials, refresh, options.log, options.proxyOptions ?? connectionProxyOptions(credentials))
    .finally(() => { flights.delete(connectionId); });
  flights.set(connectionId, flight);
  return flight;
}

// Refreshes with the generic Provider token endpoint, not the Executor. Paths
// outside the Executors (legacy gateway, media, discovery) use it.
export const providerTokenRefresh: RefreshFunction = (_credentials, connection) => refreshProviderToken(connection) as Promise<Record<string, any> | null>;

// The token that a Provider request sends for these Credentials.
export function credentialToken(credentials: Record<string, any> | null | undefined): string | null {
  return credentials?.accessToken || credentials?.apiKey || null;
}

// After the Provider rejected `failedAccessToken`: refresh once, or join the
// refresh already in flight for the Connection. Returns the stored
// Credentials when they hold a token other than the failed one, else null.
export async function refreshAfterAuthFailure(
  runtime: RefreshRuntime,
  connectionId: string,
  failedAccessToken: string | null,
  options: Omit<RefreshOptions, "failedAccessToken"> = {},
): Promise<Record<string, any> | null> {
  const outcome = await refreshConnectionCredentials(runtime, connectionId, { ...options, failedAccessToken });
  const token = credentialToken(outcome?.credentials);
  return outcome && token && token !== failedAccessToken ? outcome.credentials : null;
}

// For background jobs and probes that build their own Credentials object.
// Refreshes the stored Connection when its token is near expiry, then copies
// the stored token fields into `credentials`. The caller keeps its own
// providerSpecificData and proxy settings.
export async function refreshExpiringCredentials(
  runtime: RefreshRuntime,
  connectionId: string,
  credentials: Record<string, any>,
  options: Pick<RefreshOptions, "proxyOptions" | "log"> = {},
): Promise<RefreshResult | null> {
  const outcome = await refreshConnectionCredentials(runtime, connectionId, options);
  if (outcome) {
    const { providerSpecificData: _ignored, ...fields } = outcome.credentials;
    Object.assign(credentials, fields);
  }
  return outcome;
}

function isStale(connection: ProviderConnection, credentials: Record<string, any>, options: RefreshOptions): boolean {
  if (options.failedAccessToken !== undefined) {
    // Another request already stored a new token: use it, do not refresh.
    // Match every token field, not only credentialToken(): the legacy
    // gateway sends apiKey before accessToken.
    const stored = [credentials.accessToken, credentials.apiKey, credentials.token].map((token) => token || null);
    return stored.includes(options.failedAccessToken || null);
  }
  const executor = getV2Executor(connection.provider);
  return executor?.needsRefresh ? Boolean(executor.needsRefresh(credentials)) : shouldRefreshCredentials(connection.provider, credentials);
}

function executorRefresh(provider: string): RefreshFunction | null {
  const executor = getV2Executor(provider);
  if (!executor || executor.noAuth || typeof executor.refreshCredentials !== "function") return null;
  return (credentials, _connection, { log, proxyOptions }) => executor.refreshCredentials!(credentials, log, proxyOptions);
}

async function runRefresh(runtime: RefreshRuntime, connection: ProviderConnection, credentials: Record<string, any>, refresh: RefreshFunction, log: any, proxyOptions: Record<string, unknown>): Promise<RefreshResult | null> {
  const sentProviderData = snapshot(credentials.providerSpecificData);
  let result: Record<string, any> | null | undefined;
  try {
    result = await refresh(credentials, connection, { log, proxyOptions });
  } catch (error) {
    log?.warn?.("TOKEN_REFRESH", `${connection.provider} refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!result || !(result.accessToken || result.apiKey)) return null;

  const latest = runtime.repos.providers.get(connection.id);
  if (!latest) return null;
  const stored = runtime.repos.providers.patch(connection.id, { data: refreshPatch(latest, sentProviderData, result) }) ?? latest;
  const { providerSpecificData: _ignored, ...resultFields } = result;
  return { refreshed: true, credentials: { ...connectionCredentials(runtime, stored), ...resultFields } };
}

const STORED_FIELDS = ["accessToken", "refreshToken", "idToken", "apiKey", "lastRefreshAt", "projectId"] as const;

// Only the fields that the refresh changed. Executors often echo the whole
// providerSpecificData they received, which for v2 rows is a copy of the
// Connection data. Writing that copy back would overwrite newer fields.
function refreshPatch(connection: ProviderConnection, sentProviderData: Record<string, unknown> | null, result: Record<string, any>): Record<string, unknown> {
  const extras = changedEntries(sentProviderData, result.providerSpecificData);
  const data: Record<string, unknown> = { ...(extras ?? {}) };
  for (const key of STORED_FIELDS) if (result[key]) data[key] = result[key];
  if (result.expiresIn) data.expiresAt = new Date(Date.now() + Number(result.expiresIn) * 1000).toISOString();
  else if (result.expiresAt) data.expiresAt = result.expiresAt;
  // v1-shaped rows keep extras in a nested providerSpecificData object.
  if (extras && isPlainObject(connection.data.providerSpecificData)) data.providerSpecificData = extras;
  data.testStatus = "active";
  return data;
}

function changedEntries(before: Record<string, unknown> | null, after: unknown): Record<string, unknown> | null {
  if (!isPlainObject(after)) return null;
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(value) !== JSON.stringify(before?.[key])) changed[key] = value;
  }
  return Object.keys(changed).length ? changed : null;
}

function snapshot(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return { ...value }; }
}
