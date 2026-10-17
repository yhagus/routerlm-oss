import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../../providers/config/providers.ts";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../../providers/registryShared.ts";
import { customNodeType, openAICompatibleApiType } from "../../providers/customNodes.ts";
import { getCachedClaudeHeaders } from "../utils/claudeHeaderCache.js";
import { proxyAwareFetch } from "../../common/proxyFetch.ts";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { stripUnsupportedParams } from "../translator/concerns/paramSupport.js";

// Auth header descriptors — derived from registry transport.auth, fallback to hardcoded defaults.
const BEARER = { combined: true, header: "Authorization", scheme: "bearer" };
const XAPIKEY = { combined: true, header: "x-api-key", scheme: "raw" };
const AUTH_DESCRIPTORS = Object.fromEntries(
  Object.entries(PROVIDERS as Record<string, any>)
    .filter(([, t]) => t.auth)
    .map(([id, t]) => [id, t.auth])
);

// Apply a token to a header per scheme (matches legacy: combined always sets, even when undefined).
function setAuth(headers: any, spec: any, token: any) {
  headers[spec.header] = spec.scheme === "bearer" ? `Bearer ${token}` : token;
}

// Resolve auth onto headers from a descriptor.
function applyAuth(headers: any, desc: any, credentials: any) {
  if (desc.combined) {
    // combined providers always set the header (legacy behavior, incl. noAuth → "Bearer undefined")
    setAuth(headers, desc, credentials.apiKey || credentials.accessToken);
    if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    return;
  }
  // split apiKey/oauth: set only the matching branch (legacy: anthropic-compatible skips when both absent)
  if (credentials.apiKey) setAuth(headers, desc.apiKey, credentials.apiKey);
  else if (credentials.accessToken) setAuth(headers, desc.oauth, credentials.accessToken);
  if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
}

// Provider-specific header quirks kept as small hooks (not pure auth).
const HEADER_HOOKS = {
  claudeOverlay: (h: any) => {
    const cached = getCachedClaudeHeaders();
    if (!cached) return;
    for (const lcKey of Object.keys(cached)) {
      const titleKey = lcKey.replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
      if (lcKey === "anthropic-beta") {
        const staticBetaStr = h[titleKey] || h[lcKey] || "";
        const flags = new Set(staticBetaStr.split(",").map((f: any) => f.trim()).filter(Boolean));
        for (const f of cached[lcKey].split(",").map((f: any) => f.trim()).filter(Boolean)) flags.add(f);
        cached[lcKey] = Array.from(flags).join(",");
      }
      if (titleKey !== lcKey && h[titleKey] !== undefined) delete h[titleKey];
    }
    Object.assign(h, cached);
  },
  deepseekHarnessHeaders: (h: any, c: any) => {
    h["user-agent"] = "deepseek-harness/0.2.1-alpha.2 (+https://github.com/deepseek-ai/deepseek-harness)";
    const userId = c?.providerSpecificData?.userId;
    if (userId) h["x-deepseek-harness-user-id"] = String(userId);
    const sessionId = c?._clientSessionId;
    if (sessionId) h["x-deepseek-harness-session-id"] = String(sessionId);
    if (c?.purpose === "compaction") h["x-deepseek-harness-compact"] = "1";
  },
};

// Config-driven OAuth refresh grants — derived from registry oauth.refresh.
const REFRESH_GRANTS = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH as Record<string, any>)
    .filter(([, o]) => o.refresh)
    .map(([id, o]) => {
      const tokenUrl = o.tokenUrl;
      const encoding = o.refresh.encoding;
      const extraParams = o.refresh.scope ? { scope: o.refresh.scope } : {};
      return [id, {
        encoding,
        url: () => tokenUrl,
        params: () => ({ client_id: o.clientId, ...extraParams }),
      }];
    })
);

export class DefaultExecutor extends BaseExecutor {
  constructor(provider: any) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  transformRequest(model: any, body: any, stream?: any, credentials?: any) {
    const transformed = this.applyJsonSchemaFallback(body);

    if (transformed && typeof transformed === "object") {
      // quirk: some openai-compatible providers reject Anthropic's client_metadata field
      if (this.config.quirks?.dropClientMetadata) {
        delete transformed.client_metadata;
      }
      stripUnsupportedParams(this.provider, model, transformed);
    }

    return injectReasoningContent({ provider: this.provider, model, body: transformed });
  }

  // Fallback json_schema → json_object for openai-compatible providers without native Structured Output.
  applyJsonSchemaFallback(body: any) {
    if (customNodeType(this.provider) !== "openai-compatible") return body;
    const rf = body?.response_format;
    if (rf?.type !== "json_schema" || !rf.json_schema?.schema) return body;

    const schemaJson = JSON.stringify(rf.json_schema.schema, null, 2);
    const prompt = `You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.`;

    const messages = Array.isArray(body.messages) ? body.messages.map((m: any) => ({ ...m })) : [];
    const sys = messages.find((m: any) => m.role === "system");
    if (sys) {
      if (typeof sys.content === "string") sys.content = `${sys.content}\n\n${prompt}`;
      else if (Array.isArray(sys.content)) sys.content.push({ type: "text", text: `\n\n${prompt}` });
    } else {
      messages.unshift({ role: "system", content: prompt });
    }
    return { ...body, messages, response_format: { type: "json_object" } };
  }

  buildUrl(model: any, stream: any, urlIndex = 0, credentials: any = null) {
    // Runtime transport (multi-endpoint providers): use the sourceFormat-matched endpoint
    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      return rt.urlSuffix ? `${rt.baseUrl}${rt.urlSuffix}` : rt.baseUrl;
    }
    if (customNodeType(this.provider) === "openai-compatible") {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const path = openAICompatibleApiType(this.provider) === "responses" ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (customNodeType(this.provider) === "anthropic-compatible") {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    // gemini-format: build :streamGenerateContent / :generateContent path
    if (this.config.format === "gemini") {
      return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    }
    // urlSuffix (e.g. ?beta=true) declared per-provider in registry
    if (this.config.urlSuffix) {
      return `${this.config.baseUrl}${this.config.urlSuffix}`;
    }
    const url = this.config.baseUrl;
    if (url?.includes("{accountId}")) {
      const accountId = credentials?.providerSpecificData?.accountId;
      if (!accountId) throw new Error(`${this.provider} requires accountId in providerSpecificData`);
      return url.replace("{accountId}", accountId);
    }
    return url;
  }

  // Fallback descriptor for providers without an explicit entry in AUTH_DESCRIPTORS.
  resolveAuthDescriptor() {
    if (customNodeType(this.provider) === "anthropic-compatible") {
      return { apiKey: { header: "x-api-key", scheme: "raw" }, oauth: { header: "Authorization", scheme: "bearer" }, anthropicVersion: true };
    }
    if (this.config?.format === "claude") {
      return { ...XAPIKEY, anthropicVersion: true };
    }
    return BEARER;
  }

  buildHeaders(credentials: any, stream = true) {
    const rt = credentials?.runtimeTransport;
    const headers: Record<string, any> = { "Content-Type": "application/json", ...(rt ? rt.headers : this.config.headers) };
    const desc = rt?.auth || AUTH_DESCRIPTORS[this.provider] || this.resolveAuthDescriptor();
    // Hooks run BEFORE auth so dynamic overlays (claude cached headers) can't clobber the token.
    for (const hook of desc.hooks || []) (HEADER_HOOKS as Record<string, any>)[hook]?.(headers, credentials);
    applyAuth(headers, desc, credentials);

    // Strip first-party Claude Code identity headers for non-Anthropic anthropic-compatible upstreams
    if (customNodeType(this.provider) === "anthropic-compatible") {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "";
      const isOfficialAnthropic = baseUrl === "" || baseUrl.includes("api.anthropic.com");
      if (!isOfficialAnthropic) {
        // Some third-party Anthropic-compatible gateways require Bearer auth in
        // addition to x-api-key. Send both (x-api-key already set above) so
        // gateways that read either header succeed.
        if (credentials.apiKey && !headers["Authorization"]) {
          headers["Authorization"] = `Bearer ${credentials.apiKey}`;
        }
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];
        // Strip claude-code-20250219 from Anthropic-Beta / anthropic-beta
        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey]
              .split(",")
              .map((s: any) => s.trim())
              .filter((f: any) => f && f !== "claude-code-20250219")
              .join(",");
            if (filtered) {
              headers[betaKey] = filtered;
            } else {
              delete headers[betaKey];
            }
          }
        }
      }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  // Generic OAuth refresh for the common {grant_type, refresh_token, client_id[, ...]} shape.
  // grant = REFRESH_GRANTS[provider]; client creds resolved from PROVIDERS or this.config.
  refreshFromGrant(credentials: any, proxyOptions: any) {
    const grant = (REFRESH_GRANTS as Record<string, any>)[this.provider];
    const params = { grant_type: "refresh_token", refresh_token: credentials.refreshToken, ...grant.params(this) };
    return grant.encoding === "json"
      ? this.refreshWithJSON(grant.url(), params, proxyOptions)
      : this.refreshWithForm(grant.url(), params, proxyOptions);
  }

  async refreshCredentials(credentials: any, log: any, proxyOptions: any = null) {
    if (!credentials.refreshToken) return null;

    const refreshers = {
      claude: () => this.refreshFromGrant(credentials, proxyOptions),
      codex: () => this.refreshFromGrant(credentials, proxyOptions),
    };

    const refresher = (refreshers as Record<string, any>)[this.provider];
    if (!refresher) return null;

    try {
      const result = await refresher();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (error: any) {
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshWithJSON(url: any, body: any, proxyOptions: any = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || body.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshWithForm(url: any, params: any, proxyOptions: any = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams(params)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || params.refresh_token, expiresIn: tokens.expires_in };
  }
}
