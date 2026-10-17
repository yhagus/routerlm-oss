import type { Runtime } from "../../runtime";
import { applyCliTool } from "./cliTools";

export const CLI_TOOL_IDS = [
  "claude",
  "codex",
  "opencode",
  "droid",
  "openclaw",
  "hermes",
  "cowork",
  "copilot",
  "cline",
  "kilo",
  "deepseek-tui",
  "jcode",
  "grok-build",
  "devin",
] as const;

export type CliToolId = typeof CLI_TOOL_IDS[number];

const CONFIG_PATHS: Record<CliToolId, string | null> = {
  claude: "~/.claude/settings.json",
  codex: "~/.codex/config.toml",
  opencode: "~/.config/opencode/opencode.json",
  droid: "~/.factory/settings.json",
  openclaw: "~/.openclaw/openclaw.json",
  hermes: "~/.hermes/config.yaml",
  cowork: "Claude Desktop managed config",
  copilot: "VS Code chatLanguageModels.json",
  cline: "~/.cline/data/globalState.json",
  kilo: "~/.local/share/kilo/auth.json",
  "deepseek-tui": "~/.deepseek/config.toml",
  jcode: "~/.jcode/config.toml",
  "grok-build": "~/.grok/config.toml",
  devin: null,
};

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function normalizeCliBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const base = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function configFor(tool: CliToolId, baseUrl: string, apiKey: string, models: string[], activeModel: string): unknown {
  const model = activeModel || models[0];
  switch (tool) {
    case "claude":
      return { hasCompletedOnboarding: true, env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: apiKey, ANTHROPIC_MODEL: model } };
    case "codex":
      return `model = ${tomlString(model)}\nmodel_provider = "lobakai"\n\n[model_providers.lobakai]\nname = "LobakAI"\nbase_url = ${tomlString(baseUrl)}\nwire_api = "responses"\n`;
    case "opencode":
      return { provider: { "lobakai": { npm: "@ai-sdk/openai-compatible", options: { baseURL: baseUrl, apiKey }, models: Object.fromEntries(models.map((item) => [item, { name: item, modalities: { input: ["text", "image"], output: ["text"] } }])) } }, model: `lobakai/${model}` };
    case "droid":
      return { customModels: models.map((item, index) => ({ model: item, id: `custom:LobakAI-${index}`, index, baseUrl, apiKey, displayName: item, maxOutputTokens: 131072, noImageSupport: false, provider: "openai" })) };
    case "openclaw":
      return { models: { providers: { "lobakai": { baseUrl, apiKey, api: "openai-completions", models: models.map((item) => ({ id: item, name: item })) } } }, agents: { defaults: { model: { primary: `lobakai/${model}` } } } };
    case "hermes":
      return `model:\n  default: ${tomlString(model)}\n  provider: "custom"\n  base_url: ${tomlString(baseUrl)}\n`;
    case "cowork":
      return { inferenceProvider: "gateway", inferenceGatewayBaseUrl: baseUrl, inferenceGatewayApiKey: apiKey, inferenceModels: models.map((name) => ({ name })), managedMcpServers: [] as any[]};
    case "copilot":
      return [{ name: "LobakAI", vendor: "azure", apiKey, models: models.map((id) => ({ id, name: id, url: `${baseUrl}/chat/completions#models.ai.azure.com`, toolCalling: true, vision: false, maxInputTokens: 128000, maxOutputTokens: 16000 })) }];
    case "cline":
      return { actModeApiProvider: "openai", planModeApiProvider: "openai", openAiBaseUrl: baseUrl.replace(/\/v1$/, ""), openAiModelId: model, planModeOpenAiModelId: model, openAiApiKey: apiKey };
    case "kilo":
      return { "openai-compatible": { type: "api-key", apiKey, baseUrl, model } };
    case "deepseek-tui":
      return `provider = "openai"\n\n[providers.openai]\nbase_url = ${tomlString(baseUrl)}\napi_key = ${tomlString(apiKey)}\nmodel = ${tomlString(model)}\n`;
    case "jcode":
      return `[providers.lobakai]\ntype = "openai-compatible"\nbase_url = ${tomlString(baseUrl)}\nauth = "bearer"\napi_key_env = "JCODE_LOBAKAI_API_KEY"\ndefault_model = ${tomlString(model)}\n`;
    case "grok-build":
      return `[model]\nbase_url = ${tomlString(baseUrl)}\napi_key = ${tomlString(apiKey)}\nmodel = ${tomlString(model)}\n`;
    case "devin":
      return { capability: "auth-only", message: "Devin manages its own authentication and has no v2 config writer" };
  }
}

export async function cliToolConfig(tool: CliToolId, body: Record<string, unknown>, runtime: Runtime): Promise<{ config: unknown; content: string; models: string[]; activeModel: string; configPath: string | null; persisted: boolean } | { error: string }> {
  const env = body.env && typeof body.env === "object" && !Array.isArray(body.env) ? body.env as Record<string, unknown> : {};
  if (tool === "claude" && Object.keys(env).length > 0 && !body.baseUrl) {
    const config = { hasCompletedOnboarding: true, env: { ...env } };
    try {
      await applyCliTool(tool, body);
      return { config, content: JSON.stringify(config, null, 2), models: [] as any[], activeModel: "", configPath: CONFIG_PATHS[tool], persisted: true };
    } catch (error: any) {
      return { error: error instanceof Error ? error.message : "Could not persist local CLI configuration" };
    }
  }
  const baseUrl = normalizeCliBaseUrl(body.baseUrl || env.ANTHROPIC_BASE_URL);
  if (!baseUrl) return { error: "A valid baseUrl is required" };
  const requested = Array.isArray(body.models) ? body.models.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()) : [];
  const single = typeof body.model === "string" ? body.model.trim() : "";
  const discovered = runtime.gateway.models("chat").map((item) => String(item.id)).filter((value): value is string => value.length > 0);
  const models = [...new Set<string>(requested.length ? requested : single ? [single] : discovered)];
  if (!models.length) return { error: "At least one model is required" };
  const activeModel = stringValue(body.activeModel, models[0]);
  const apiKey = stringValue(body.apiKey || env.ANTHROPIC_AUTH_TOKEN, "<API_KEY_FROM_DASHBOARD>");
  const config = configFor(tool, baseUrl, apiKey, models, activeModel);
  // Preview and persistence must be driven by the same normalized input. The
  // previous raw body could omit a discovered model or Claude's required env.
  const resolved = {
    ...body,
    baseUrl,
    apiKey,
    models,
    model: activeModel,
    activeModel,
    ...(tool === "claude" ? { env: (config as { env: Record<string, unknown> }).env } : {}),
  };
  try {
    await applyCliTool(tool, resolved);
  } catch (error: any) {
    return { error: error instanceof Error ? error.message : "Could not persist local CLI configuration" };
  }
  return { config, content: typeof config === "string" ? config : JSON.stringify(config, null, 2), models, activeModel, configPath: CONFIG_PATHS[tool], persisted: true };
}

export function cliToolStatus(tool: CliToolId, runtime: Runtime): Record<string, unknown> {
  return {
    installed: false,
    settings: null,
    hasLobakAI: false,
    configPath: CONFIG_PATHS[tool],
    message: "Local CLI detection is not available in the v2 backend",
    capability: {
      id: `cli-tools/${tool}-settings`,
      status: "generation_only",
      canGenerate: tool !== "devin",
      canDetectLocalInstall: false,
      canApplyLocally: true,
      reason: "writes the local LobakAI-owned client configuration",
    },
    models: runtime.gateway.models("chat").map((model) => String(model.id)),
  };
}

export function isCliToolId(value: string): value is CliToolId {
  return (CLI_TOOL_IDS as readonly string[]).includes(value);
}
