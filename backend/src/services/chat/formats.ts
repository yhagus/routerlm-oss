import { detectFormat, resolveTransport, getTargetFormat } from "../providers/provider.ts";
import { detectFormatByEndpoint } from "./translator/formats.js";
// The v1 model registry is JavaScript and intentionally remains the source of truth.
import { getModelTargetFormat, getModelUpstreamId } from "../providers/config/providerModels.ts";
import { resolveProviderTransport } from "../providers/providerCatalog";

export type ClientFormat = "openai" | "claude" | "responses" | "ollama";

const CLIENT_TO_V1_FORMAT: Record<ClientFormat, string> = {
  openai: "openai",
  claude: "claude",
  responses: "openai-responses",
  ollama: "ollama",
};

export function clientFormatToV1(format: ClientFormat): string {
  return CLIENT_TO_V1_FORMAT[format] || "openai";
}

// Endpoint-based detection wins (a Responses body on /chat/completions is
// Cursor's quirk), then body-shape heuristics.
export function detectSourceFormat(pathname: string | null, body: Record<string, unknown>): string {
  const byEndpoint = pathname ? detectFormatByEndpoint(pathname, body) : null;
  return byEndpoint || detectFormat(body) || "openai";
}

// v1 target resolution: model-level override → transport negotiated with the
// source format → provider default.
export function resolveExecutionTarget(provider: string, model: string, sourceFormat: string): { targetFormat: string; upstreamModel: string } {
  const targetFormat = getModelTargetFormat(provider, model) || resolveProviderTransport(provider, sourceFormat)?.format || resolveTransport(provider, sourceFormat)?.format || getTargetFormat(provider) || "openai";
  return { targetFormat, upstreamModel: getModelUpstreamId(provider, model) || model };
}
