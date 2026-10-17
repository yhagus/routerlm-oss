import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../../providers/config/providers.ts";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../../providers/registryShared.ts";

// OpenCode Go subscription now uses the Console /inference/* endpoints (see
// https://opencode.ai/docs/zen). Qwen and MiniMax models route through the
// Anthropic-native endpoint with x-api-key auth; everything else uses the
// OpenAI-compatible chat endpoint with Bearer auth.
const MESSAGES_FORMAT_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
]);

const BASE = "https://opencode.ai/inference";

export class OpenCodeGoExecutor extends BaseExecutor {
  _lastModel: any;
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  buildUrl(model: any) {
    this._lastModel = model;
    return MESSAGES_FORMAT_MODELS.has(model)
      ? `${BASE}/anthropic/v1/messages`
      : `${BASE}/openai/v1/chat/completions`;
  }

  buildHeaders(credentials: any, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers: Record<string, any> = { "Content-Type": "application/json" };

    if (MESSAGES_FORMAT_MODELS.has(this._lastModel)) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model: any, body: any) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}
