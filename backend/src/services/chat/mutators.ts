// v1 chatCore body mutators, in v1 order. Pre-translation: bypass patterns,
// combo identity, provider thinking. Post-translation: RTK → headroom →
// caveman → ponytail → pxpipe token savers, all gated by the per-request
// opt-out header (x-lobakai-token-saver: off) exactly like v1.
import type { Runtime } from "../../runtime";
import { handleBypassRequest } from "./utils/bypassHandler.js";
import { detectClientTool, isNativePassthrough } from "./utils/clientDetector.js";
import { applyComboIdentity } from "./comboIdentity.js";
import { compressMessages } from "./tokenSavers/index.js";
import { compressWithHeadroom } from "./tokenSavers/headroom.js";
import { injectCaveman } from "./tokenSavers/caveman.js";
import { injectPonytail } from "./tokenSavers/ponytail.js";
import { compressWithPxpipe } from "./tokenSavers/pxpipe.js";
import { TOKEN_SAVER_HEADER } from "../providers/config/runtimeConfig.ts";
import { getTransform as getPxpipeTransform } from "../platform/pxpipe/loader.ts";
import { appendPxpipeEvent } from "../platform/pxpipe/events.ts";

// Lowercase header key/value object, matching v1's clientRawRequest.headers
// shape (what detectClientTool indexes into).
export type MutatorHeaders = Record<string, string>;

// v1 runs the bypass check before combo rotation so warmup/title requests
// never consume rotation slots.
export function tryBypassRequest(runtime: Runtime, body: Record<string, unknown>, model: string, userAgent: string): Response | null {
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const bypass = handleBypassRequest(body, model, userAgent, !!settings.ccFilterNaming);
  return bypass ? ((bypass.response || bypass) as Response) : null;
}

// v1 chatCore provider-level thinking override: on/off → body.thinking,
// none/low/medium/high → body.reasoning_effort. Only when the client hasn't
// set the field itself.
export function applyProviderThinking(body: Record<string, unknown>, providerThinking: { mode?: string } | null): Record<string, unknown> {
  if (!providerThinking?.mode || providerThinking.mode === "auto") return body;
  const mode = providerThinking.mode;
  if (mode === "on" && !body.thinking) {
    return { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
  }
  if (mode === "off" && !body.thinking) {
    return { ...body, thinking: { type: "disabled" } };
  }
  if (!body.reasoning_effort) {
    return { ...body, reasoning_effort: mode };
  }
  return body;
}

export function comboIdentityBody(body: Record<string, unknown>, sourceFormat: string, comboIdentityName: string | null): Record<string, unknown> {
  if (!comboIdentityName) return body;
  return applyComboIdentity(body, sourceFormat, comboIdentityName) as Record<string, unknown>;
}

// v1 client tool detection (user-agent + body shape) drives passthrough and
// the deepseek-tui stream override.
export function detectTool(headers: MutatorHeaders | null, body: Record<string, unknown>): string | null {
  return detectClientTool(headers || {}, body) as string | null;
}

export function nativePassthrough(clientTool: string | null, provider: string): boolean {
  return isNativePassthrough(clientTool, provider) as boolean;
}

export interface TokenSaverResult {
  body: Record<string, unknown>;
  pxpipeSummary: Record<string, unknown> | null;
}

// The v1 token-saver chain over the final (translated or passthrough) body.
// Mutates translatedBody in place like v1; pxpipe may return a new body.
export async function applyTokenSavers(
  runtime: Runtime,
  headers: MutatorHeaders | null,
  translatedBody: Record<string, unknown>,
  options: { provider: string; model: string; format: string },
): Promise<TokenSaverResult> {
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const tokenSaverEnabled = String(headers?.[TOKEN_SAVER_HEADER] ?? "").toLowerCase() !== "off";

  // RTK: compress tool_result content
  compressMessages(translatedBody, tokenSaverEnabled && !!settings.rtkEnabled);

  // Headroom: optional external proxy compression; fail open if absent.
  const headroomDiagnostics: Record<string, unknown> = {};
  await compressWithHeadroom(translatedBody, {
    enabled: tokenSaverEnabled && !!settings.headroomEnabled,
    url: settings.headroomUrl,
    model: options.model,
    format: options.format,
    compressUserMessages: !!settings.headroomCompressUserMessages,
    diagnostics: headroomDiagnostics,
  });

  // Caveman: terse-style system prompt
  if (tokenSaverEnabled && settings.cavemanEnabled && settings.cavemanLevel) {
    injectCaveman(translatedBody, options.format, settings.cavemanLevel);
  }

  // Ponytail: lazy-senior-dev system prompt
  if (tokenSaverEnabled && settings.ponytailEnabled && settings.ponytailLevel) {
    injectPonytail(translatedBody, options.format, settings.ponytailLevel);
  }

  // PXPIPE: image bulky context (Claude-format bodies only), last saver before dispatch
  let pxpipeSummary: Record<string, unknown> | null = null;
  if (settings.pxpipeEnabled) {
    const transform = await getPxpipeTransform();
    const pxpipeResult = await compressWithPxpipe(translatedBody, {
      enabled: true,
      format: options.format,
      model: options.model,
      minChars: settings.pxpipeMinChars,
      timeoutMs: settings.pxpipeTimeoutMs,
      transform,
    });
    pxpipeSummary = pxpipeResult.summary as Record<string, unknown> | null;
    try { appendPxpipeEvent({ provider: options.provider, model: options.model, ...pxpipeSummary }); } catch { /* stats must not break requests */ }
    if (pxpipeResult.body) return { body: pxpipeResult.body as Record<string, unknown>, pxpipeSummary };
  }

  return { body: translatedBody, pxpipeSummary };
}
