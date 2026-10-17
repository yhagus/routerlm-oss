import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth.ts";

const CLOUD_CODE_ASSIST_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const LOAD_CODE_ASSIST_URL = `${CLOUD_CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`;
const ONBOARD_USER_URL = `${CLOUD_CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`;
const OPERATIONS_URL = `${CLOUD_CODE_ASSIST_ENDPOINT}/v1internal`;
const FREE_TIER_ID = "free-tier";
const ONBOARD_TIMEOUT_MS = 30_000;
const ONBOARD_POLL_INTERVAL_MS = 1_000;
const PROVIDER = "antigravity";

const ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA = Object.freeze({
  ideType: "ANTIGRAVITY",
});

function throwIfLoginCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Login cancelled");
}

async function oauthFetch(url: string, init: RequestInit, options: { provider?: string; signal?: AbortSignal; timeoutMs?: number }) {
  const controller = new AbortController();
  const signals: AbortSignal[] = [controller.signal];
  if (options.signal) signals.push(options.signal);
  const timeout = options.timeoutMs ? setTimeout(() => controller.abort(new Error("Request timeout")), options.timeoutMs) : null;
  try {
    return await fetch(url, { ...init, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function requestCloudCodeAssist({ label, url, method, headers, body, signal, timeoutMs }: { label: string; url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal?: AbortSignal; timeoutMs?: number }) {
  throwIfLoginCancelled(signal);
  const init: RequestInit = body === undefined ? { method, headers } : { method, headers, body };
  const response = await oauthFetch(url, init, { provider: PROVIDER, signal, timeoutMs });
  if (response.status !== 200) {
    const errorText = await response.text();
    throw new Error(`${label} failed: ${response.status} ${response.statusText}: ${errorText}`);
  }
  return response.json();
}

async function postLoadCodeAssist(context: { headers: Record<string, string>; signal?: AbortSignal }, body: Record<string, unknown>) {
  const payload = await requestCloudCodeAssist({
    ...context,
    label: "loadCodeAssist",
    url: LOAD_CODE_ASSIST_URL,
    method: "POST",
    body: JSON.stringify(body),
  });
  return payload as { currentTier?: { id?: string } | null; paidTier?: { id?: string } | null; allowedTiers?: Array<{ id?: string; isDefault?: boolean }>; ineligibleTiers?: Array<{ tierId?: string; reasonMessage?: string; validationUrl?: string }>; cloudaicompanionProject?: string | { id?: string } };
}

function extractProjectId(payload: { cloudaicompanionProject?: string | { id?: string } }): string | undefined {
  const project = payload.cloudaicompanionProject;
  if (typeof project === "string") return project || undefined;
  if (project && typeof project === "object") return project.id || undefined;
  return undefined;
}

function hasMessageField(payload: { currentTier?: unknown; paidTier?: unknown }, field: "currentTier" | "paidTier"): boolean {
  return payload[field] !== undefined && payload[field] !== null;
}

function isFreeTierAllowed(payload: { allowedTiers?: Array<{ id?: string }> }): boolean {
  return payload.allowedTiers?.some(tier => tier.id === FREE_TIER_ID) === true;
}

function getFreeTierIneligibility(payload: { ineligibleTiers?: Array<{ tierId?: string; reasonMessage?: string; validationUrl?: string }> }): { reasonMessage: string; validationUrl: string | undefined } | undefined {
  const tier = payload.ineligibleTiers?.find(candidate => candidate.tierId === FREE_TIER_ID);
  if (!tier?.reasonMessage) return undefined;
  return {
    reasonMessage: tier.reasonMessage,
    validationUrl: tier.validationUrl && tier.validationUrl.length > 0 ? tier.validationUrl : undefined,
  };
}

function assertFreeTierEligible(payload: { allowedTiers?: Array<{ id?: string }>; ineligibleTiers?: Array<{ tierId?: string; reasonMessage?: string; validationUrl?: string }> }) {
  if (isFreeTierAllowed(payload)) return;
  const ineligibility = getFreeTierIneligibility(payload);
  if (!ineligibility) return;
  const validation = ineligibility.validationUrl ? `\n${ineligibility.validationUrl}` : "";
  throw new Error(`${ineligibility.reasonMessage}${validation}`);
}

async function loadCodeAssist(context: { headers: Record<string, string>; signal?: AbortSignal }) {
  let payload = await postLoadCodeAssist(context, {
    metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
  });
  const projectId = extractProjectId(payload);
  if (!hasMessageField(payload, "paidTier") && projectId) {
    payload = await postLoadCodeAssist(context, {
      cloudaicompanionProject: projectId,
      metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
    });
  }
  return payload;
}

function remainingOnboardTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining > 0) return remaining;
  throw new Error(`onboardUser timed out after ${ONBOARD_TIMEOUT_MS}ms`);
}

async function onboardUser(context: { headers: Record<string, string>; signal?: AbortSignal }) {
  const deadline = Date.now() + ONBOARD_TIMEOUT_MS;
  let operation = await requestCloudCodeAssist({
    ...context,
    label: "onboardUser",
    url: ONBOARD_USER_URL,
    method: "POST",
    body: JSON.stringify({
      tierId: FREE_TIER_ID,
      metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
    }),
    timeoutMs: remainingOnboardTime(deadline),
  }) as { name?: string; done?: boolean; error?: { code?: number; message?: string } | null; response?: { "@type": string; cloudaicompanionProject?: string } | null };

  while (true) {
    if (operation.done === true) {
      if (operation.error !== undefined && operation.error !== null) {
        const err = operation.error;
        const msg = err.message ? (typeof err.code === "number" ? `${err.code}: ${err.message}` : err.message) : JSON.stringify(err);
        throw new Error(`OnboardUser operation failed: ${msg}`);
      }
      if (operation.response === undefined || operation.response === null) {
        throw new Error("failed to unmarshal OnboardUserResponse");
      }
      return;
    }

    await new Promise(resolve => setTimeout(resolve, Math.min(ONBOARD_POLL_INTERVAL_MS, remainingOnboardTime(deadline))));
    throwIfLoginCancelled(context.signal);
    const operationName = operation.name ?? "";
    if (operationName.length === 0) {
      throw new Error("onboardUser returned an operation without a name");
    }
    operation = await requestCloudCodeAssist({
      ...context,
      label: "onboardUser operation",
      url: `${OPERATIONS_URL}/${operationName}`,
      method: "GET",
      timeoutMs: remainingOnboardTime(deadline),
    }) as { name?: string; done?: boolean; error?: { code?: number; message?: string } | null; response?: { "@type": string; cloudaicompanionProject?: string } | null };
  }
}

async function discoverProject(accessToken: string, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<string> {
  const context = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent || "google-api-nodejs-client/9.15.1",
      "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient || "google-cloud-sdk vscode_cloudshelleditor/0.1",
      "Client-Metadata": ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata,
      "x-request-source": "local",
    },
    signal,
  };

  onProgress?.("Checking Cloud Code Assist account status...");
  try {
    const initial = await loadCodeAssist(context);
    assertFreeTierEligible(initial);
    if (!hasMessageField(initial, "currentTier")) {
      onProgress?.("Provisioning the Antigravity free tier...");
      await onboardUser(context);
    }

    onProgress?.("Refreshing Cloud Code Assist project...");
    const refreshed = await loadCodeAssist(context);
    const projectId = extractProjectId(refreshed);
    if (projectId) return projectId;
    throw new Error("loadCodeAssist did not return a cloudaicompanionProject");
  } catch (error) {
    throwIfLoginCancelled(signal);
    if (error instanceof Error) throw error;
    throw new Error(`Could not discover an Antigravity project. ${String(error)}`);
  }
}

const antigravity = {
  config: ANTIGRAVITY_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config: any, redirectUri: any, state: any) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: config.scopes.join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config: any, code: any, redirectUri: any) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  },
  postExchange: async (tokens: any, context?: { onProgress?: (message: string) => void; signal?: AbortSignal }) => {
    const loadHeaders = {
      "Authorization": `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
      "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
      "Client-Metadata": ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata,
      "x-request-source": "local",
    };
    const metadata = getOAuthClientMetadata();

    // Fetch user info
    const userInfoRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "x-request-source": "local",
      },
    });
    const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};

    // Discover project with blocking onboardUser (oh-my-pi approach)
    let projectId = "";
    try {
      projectId = await discoverProject(tokens.access_token, context?.onProgress, context?.signal);
    } catch (e: any) {
      console.log("Failed to discover Antigravity project:", e?.message || e);
    }

    return { userInfo, projectId };
  },
  mapTokens: (tokens: any, extra: any) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    email: extra?.userInfo?.email,
    projectId: extra?.projectId,
  }),
};

export default antigravity;
