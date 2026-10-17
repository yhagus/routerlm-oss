import { join } from "node:path";
import { Hono } from "hono";
import { commandExists, homeDir, pathExists, readJson, readText, runProcess, writeJson, writeText } from "./host";

type JsonObject = Record<string, any>;

const tools = ["claude", "codex", "opencode", "droid", "openclaw", "hermes", "cowork", "copilot", "cline", "kilo", "deepseek-tui", "jcode", "grok-build", "devin"] as const;
export type CliTool = (typeof tools)[number];

function pathFor(tool: CliTool): string {
  const home = homeDir();
  switch (tool) {
    case "claude": return join(home, ".claude", "settings.json");
    case "codex": return join(home, ".codex", "config.toml");
    case "opencode": return join(home, ".config", "opencode", "opencode.json");
    case "droid": return join(home, ".factory", "settings.json");
    case "openclaw": return join(home, ".openclaw", "openclaw.json");
    case "hermes": return join(home, ".hermes", "config.yaml");
    case "cowork": return join(home, process.platform === "darwin" ? "Library/Application Support/Claude-3p/configLibrary/lobakai.json" : ".config/Claude-3p/configLibrary/lobakai.json");
    case "copilot": return process.platform === "darwin" ? join(home, "Library/Application Support/Code/User/chatLanguageModels.json") : join(home, ".config/Code/User/chatLanguageModels.json");
    case "cline": return join(home, ".cline", "data", "globalState.json");
    case "kilo": return join(home, ".local", "share", "kilo", "auth.json");
    case "deepseek-tui": return join(home, ".deepseek", "config.toml");
    case "jcode": return join(home, ".jcode", "config.toml");
    case "grok-build": return join(home, ".grok", "config.toml");
    case "devin": return "";
  }
}

function commandFor(tool: CliTool): string | null {
  return tool === "deepseek-tui" ? "deepseek" : tool === "grok-build" ? "grok" : tool;
}

function normalizeBaseUrl(value: unknown, withV1 = true): string {
  const base = String(value || "").trim().replace(/\/+$/, "");
  return withV1 ? (base.endsWith("/v1") ? base : `${base}/v1`) : (base.endsWith("/v1") ? base.slice(0, -3) : base);
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, any>).map(([key, item]) => /key|token|secret|password|credential|authorization/i.test(key) ? [key, "[redacted]"] : [key, redact(item)]));
}

function containsRouter(value: unknown): boolean {
  return /lobakai|localhost|127\.0\.0\.1/i.test(JSON.stringify(value || ""));
}

async function jsonAt(path: string): Promise<JsonObject | null> {
  return readJson<JsonObject | null>(path, null);
}

function tomlValue(value: string): string { return JSON.stringify(value); }

function upsertToml(text: string, key: string, value: string): string {
  const line = `${key} = ${tomlValue(value)}`;
  const expression = new RegExp(`^${key.replaceAll(".", "\\.")}\\s*=.*$`, "m");
  return expression.test(text) ? text.replace(expression, line) : `${text.trimEnd()}\n${line}\n`;
}

function removeToml(text: string, key: string): string {
  return text.replace(new RegExp(`^${key.replaceAll(".", "\\.")}\\s*=.*(?:\\r?\\n|$)`, "m"), "");
}

function upsertTomlSection(text: string, section: string, body: string): string {
  const expression = new RegExp(`^\\[${section.replaceAll(".", "\\.")}\\]\\s*$([\\s\\S]*?)(?=^\\[|$)`, "m");
  const replacement = `[${section}]\n${body.trim()}\n\n`;
  return expression.test(text) ? text.replace(expression, replacement) : `${text.trimEnd()}\n\n${replacement}`;
}

function removeTomlSection(text: string, section: string): string {
  return text.replace(new RegExp(`^\\[${section.replaceAll(".", "\\.")}\\]\\s*$([\\s\\S]*?)(?=^\\[|$)`, "m"), "");
}

function yamlModel(text: string): { default: string | null; provider: string | null; base_url: string | null } | null {
  const block = text.match(/^model:\s*\r?\n((?:[ \t]+.*\r?\n?)*)/m)?.[1];
  if (!block) return null;
  const value = (key: string) => block.match(new RegExp(`^[ \\t]+${key}:\\s*["']?([^"'\\r\\n]+)`, "m"))?.[1]?.trim() || null;
  return { default: value("default"), provider: value("provider"), base_url: value("base_url") };
}

async function isInstalled(tool: CliTool): Promise<boolean> {
  if (tool === "copilot") return true;
  const configured = pathFor(tool) ? await pathExists(pathFor(tool)) : false;
  return configured || Boolean(commandFor(tool) && await commandExists(commandFor(tool)!));
}

async function getStatus(tool: CliTool): Promise<Record<string, unknown>> {
  const installed = await isInstalled(tool);
  const configPath = pathFor(tool) || null;
  if (tool === "devin") {
    let version: string | null = null;
    if (installed) version = (await runProcess("devin", ["--version"], { timeoutMs: 1_500 })).stdout.trim().split("\n")[0] || null;
    return installed
      ? { installed: true, source: "path", version, message: "Devin CLI detected. Make sure `devin auth login` has been run." }
      : { installed: false, source: null, version: null, message: "Devin CLI is not installed.", installUrl: "https://cli.devin.ai" };
  }
  if (!installed) return { installed: false, settings: null, config: null, message: `${tool} CLI is not installed`, ...(configPath ? { configPath, settingsPath: configPath } : {}) };

  if (tool === "hermes") {
    const text = await readText(configPath!) || "";
    const model = yamlModel(text);
    return { installed: true, settings: { model }, hasLobakAI: containsRouter(model), configPath };
  }
  if (tool === "deepseek-tui" || tool === "codex" || tool === "jcode" || tool === "grok-build") {
    const text = await readText(configPath!) || "";
    return { installed: true, settings: { config: text }, config: text, hasLobakAI: containsRouter(text), configPath };
  }
  const config = await jsonAt(configPath!);
  if (tool === "copilot") {
    const entries = Array.isArray(config) ? config : [];
    const entry = entries.find((item: any) => item?.name === "LobakAI");
    return { installed: true, config: entries.length ? redact(entries) : null, hasLobakAI: Boolean(entry), configPath, currentModel: entry?.models?.[0]?.id || null, currentUrl: entry?.models?.[0]?.url || null };
  }
  if (tool === "cline") {
    return { installed: true, settings: config ? redact({ actModeApiProvider: config.actModeApiProvider, planModeApiProvider: config.planModeApiProvider, openAiBaseUrl: config.openAiBaseUrl, openAiModelId: config.openAiModelId }) : null, hasLobakAI: containsRouter(config), globalStatePath: configPath };
  }
  if (tool === "kilo") {
    return { installed: true, settings: config ? { auth: Object.keys(config) } : null, hasLobakAI: containsRouter(config), authPath: configPath };
  }
  if (tool === "openclaw") {
    return { installed: true, settings: redact(config), agents: config?.agents?.list || [], hasLobakAI: containsRouter(config), settingsPath: configPath };
  }
  if (tool === "cowork") {
    return { installed: true, config: redact(config), hasLobakAI: containsRouter(config), configPath, cowork: { baseUrl: config?.inferenceGatewayBaseUrl || null, models: config?.inferenceModels || [], plugins: config?.managedMcpServers || [] }, defaultPlugins: [] as any[], localStdioPlugins: [] as any[]};
  }
  if (tool === "opencode") {
    const provider = config?.provider?.["lobakai"];
    return { installed: true, config: redact(config), hasLobakAI: Boolean(provider), configPath, opencode: { models: Object.keys(provider?.models || {}), activeModel: config?.model?.startsWith("lobakai/") ? config.model.slice(9) : null, baseURL: provider?.options?.baseURL || null } };
  }
  return { installed: true, settings: redact(config), config: redact(config), hasLobakAI: containsRouter(config), settingsPath: configPath, configPath };
}

export async function getCliToolStatus(tool: CliTool): Promise<Record<string, unknown>> {
  const result = await getStatus(tool);
  return {
    ...result,
    // The v2 backend can persist a config file, but does not verify that a
    // desktop client has reloaded it. Keep the legacy capability flag honest.
    capability: { canGenerate: true, canApplyLocally: true, localFilePersistence: true },
  };
}

export async function applyCliTool(tool: CliTool, body: JsonObject): Promise<Record<string, unknown>> {
  const baseUrl = body.baseUrl;
  const model = body.model;
  const models = Array.isArray(body.models) ? body.models.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0) : (typeof model === "string" && Boolean(model) ? [model] : []);
  if ((!Boolean(baseUrl) && tool !== "claude") || (!Boolean(model) && models.length === 0 && tool !== "claude")) throw new Error("baseUrl and model are required");
  const path = pathFor(tool);
  if (!path) throw new Error("This CLI tool has no writable configuration");
  if (tool === "claude" && (!body.env || typeof body.env !== "object" || Array.isArray(body.env))) throw new Error("Invalid env object");
  const key = String(body.apiKey || "sk_lobakai");
  const selectedModel = String(model || models[0] || "");

  if (tool === "claude") {
    const current = (await jsonAt(path)) || {};
    const env = { ...(current.env || {}), ...(body.env && typeof body.env === "object" ? body.env : {}) };
    if (baseUrl) env.ANTHROPIC_BASE_URL = normalizeBaseUrl(baseUrl);
    if (body.apiKey) env.ANTHROPIC_AUTH_TOKEN = key;
    if (body.maxContextTokens) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(body.maxContextTokens); else delete env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
    await writeJson(path, { ...current, hasCompletedOnboarding: true, env });
  } else if (tool === "opencode") {
    const config = (await jsonAt(path)) || {};
    config.provider ||= {};
    const provider = config.provider["lobakai"] || { npm: "@ai-sdk/openai-compatible", options: {} as Record<string, any>, models: {} };
    provider.options = { ...(provider.options || {}), baseURL: normalizeBaseUrl(baseUrl), apiKey: key };
    provider.models ||= {};
    for (const item of models) provider.models[item] = { name: item, modalities: { input: ["text", "image"], output: ["text"] } };
    config.provider["lobakai"] = provider;
    config.model = `lobakai/${body.activeModel || models[0]}`;
    await writeJson(path, config);
  } else if (tool === "droid") {
    const config = (await jsonAt(path)) || {};
    config.customModels = (Array.isArray(config.customModels) ? config.customModels : []).filter((item: any) => !item?.id?.startsWith("custom:LobakAI"));
    for (const [index, item] of models.entries()) config.customModels.push({ model: item, id: `custom:LobakAI-${index}`, index, baseUrl: normalizeBaseUrl(baseUrl), apiKey: key, displayName: item, maxOutputTokens: 131072, noImageSupport: false, provider: "openai" });
    await writeJson(path, config);
  } else if (tool === "cline") {
    const config = (await jsonAt(path)) || {};
    config.actModeApiProvider = "openai"; config.planModeApiProvider = "openai"; config.openAiBaseUrl = normalizeBaseUrl(baseUrl, false); config.openAiModelId = selectedModel; config.planModeOpenAiModelId = selectedModel;
    await writeJson(path, config);
    await writeJson(join(homeDir(), ".cline", "data", "secrets.json"), { ...(await jsonAt(join(homeDir(), ".cline", "data", "secrets.json")) || {}), openAiApiKey: key });
  } else if (tool === "openclaw") {
    const config = (await jsonAt(path)) || {};
    config.models ||= {}; config.models.providers ||= {};
    config.models.providers["lobakai"] = { baseUrl: normalizeBaseUrl(baseUrl), apiKey: key, api: "openai-completions", models: models.map((item) => ({ id: item, name: item })) };
    config.agents ||= {}; config.agents.defaults ||= {}; config.agents.defaults.model = { ...(config.agents.defaults.model || {}), primary: `lobakai/${selectedModel}` };
    await writeJson(path, config);
  } else if (tool === "copilot") {
    const config = (await jsonAt(path)) as any;
    const entries = Array.isArray(config) ? config : [];
    const newEntry = { name: "LobakAI", vendor: "azure", apiKey: key, models: models.map((item) => ({ id: item, name: item, url: `${String(baseUrl).replace(/\/+$/, "")}/chat/completions#models.ai.azure.com`, toolCalling: true, vision: false, maxInputTokens: 128000, maxOutputTokens: 16000 })) };
    const index = entries.findIndex((item: any) => item?.name === "LobakAI");
    if (index >= 0) entries[index] = newEntry; else entries.push(newEntry);
    await writeJson(path, entries);
  } else if (tool === "kilo") {
    const auth = (await jsonAt(path)) || {};
    auth["openai-compatible"] = { type: "api-key", apiKey: key, baseUrl: normalizeBaseUrl(baseUrl), model: selectedModel };
    await writeJson(path, auth);
  } else if (tool === "hermes") {
    const current = await readText(path) || "";
    const block = `model:\n  default: ${tomlValue(selectedModel)}\n  provider: "custom"\n  base_url: ${tomlValue(normalizeBaseUrl(baseUrl))}\n`;
    const next = /^model:\s*\r?\n((?:[ \t]+.*\r?\n?)*)/m.test(current) ? current.replace(/^model:\s*\r?\n((?:[ \t]+.*\r?\n?)*)/m, block) : `${block}\n${current}`;
    await writeText(path, next);
    if (body.apiKey) await writeText(join(homeDir(), ".hermes", ".env"), `OPENAI_API_KEY=${key}\n`);
  } else if (tool === "deepseek-tui") {
    await writeText(path, `provider = "openai"\n\n[providers.openai]\nbase_url = ${tomlValue(normalizeBaseUrl(baseUrl))}\napi_key = ${tomlValue(key)}\nmodel = ${tomlValue(selectedModel)}\n`);
  } else if (tool === "jcode") {
    await writeText(path, `# LobakAI provider\n[providers.lobakai]\ntype = "openai-compatible"\nbase_url = ${tomlValue(normalizeBaseUrl(baseUrl))}\nauth = "bearer"\napi_key_env = "JCODE_LOBAKAI_API_KEY"\ndefault_model = ${tomlValue(models[0] || selectedModel)}\n`);
    await writeText(join(homeDir(), ".config", "jcode", "provider-lobakai.env"), `JCODE_LOBAKAI_API_KEY=${key}\n`);
  } else if (tool === "codex") {
    let current = await readText(path) || "";
    current = upsertToml(current, "model", selectedModel);
    current = upsertToml(current, "model_provider", "lobakai");
    current = upsertTomlSection(current, "model_providers.lobakai", `name = "LobakAI"\nbase_url = ${tomlValue(normalizeBaseUrl(baseUrl))}\nwire_api = "responses"`);
    current = upsertTomlSection(current, "agents.subagent", `model = ${tomlValue(String(body.subagentModel || selectedModel))}`);
    await writeText(path, current);
    await writeJson(join(homeDir(), ".codex", "auth.json"), { ...(await jsonAt(join(homeDir(), ".codex", "auth.json")) || {}), OPENAI_API_KEY: key, auth_mode: "apikey" });
  } else if (tool === "grok-build") {
    let current = await readText(path) || "";
    current = upsertTomlSection(current, "model", `base_url = ${tomlValue(normalizeBaseUrl(baseUrl))}\napi_key = ${tomlValue(key)}\nmodel = ${tomlValue(selectedModel)}`);
    await writeText(path, current);
  } else if (tool === "cowork") {
    const config = { inferenceProvider: "gateway", inferenceGatewayBaseUrl: baseUrl, inferenceGatewayApiKey: key, inferenceModels: models.map((item) => ({ name: item })) };
    await writeJson(path, config);
  }
  return { success: true, message: `${tool} settings applied successfully!`, configPath: path, generated: true, content: await readText(path) || "", models, activeModel: selectedModel };
}

export async function patchCliTool(tool: CliTool, body: JsonObject): Promise<Record<string, unknown>> {
  if (tool !== "opencode" || body.clearActiveModel !== true) return { success: true, message: "Settings updated" };
  const path = pathFor(tool);
  const config = (await jsonAt(path)) || {};
  if (typeof config.model === "string" && config.model.startsWith("lobakai/")) config.model = "";
  await writeJson(path, config);
  return { success: true, message: "Settings updated", configPath: path };
}

export async function resetCliTool(tool: CliTool, modelToRemove?: string): Promise<Record<string, unknown>> {
  const path = pathFor(tool);
  if (!path) return { success: true, message: "No settings file to reset" };
  const current = await readText(path);
  if (current == null) return { success: true, message: "No config file to reset" };
  if (tool === "opencode" && modelToRemove) {
    const config = (await jsonAt(path)) || {};
    const provider = config.provider?.["lobakai"];
    if (provider?.models) delete provider.models[modelToRemove];
    if (provider?.models && Object.keys(provider.models).length === 0) delete config.provider["lobakai"];
    if (config.model === `lobakai/${modelToRemove}`) {
      const remaining = Object.keys(provider?.models || {});
      config.model = remaining.length ? `lobakai/${remaining[0]}` : "";
    }
    await writeJson(path, config);
    return { success: true, message: `Model "${modelToRemove}" removed`, configPath: path };
  }
  if (tool === "codex") {
    let next = removeToml(removeToml(current, "model"), "model_provider");
    next = removeTomlSection(next, "model_providers.lobakai");
    next = removeTomlSection(next, "agents.subagent");
    await writeText(path, next);
    await writeJson(join(homeDir(), ".codex", "auth.json"), {});
  } else if (tool === "grok-build") {
    await writeText(path, removeTomlSection(current, "model"));
  }
  else if (["hermes"].includes(tool)) await writeText(path, current.replace(/^model:\s*\r?\n((?:[ \t]+.*\r?\n?)*)/m, ""));
  else if (tool === "deepseek-tui") await writeText(path, 'provider = "deepseek"\n');
  else if (tool === "copilot") await writeJson(path, (Array.isArray(await jsonAt(path)) ? (await jsonAt(path) as any[]).filter((item) => item?.name !== "LobakAI") : []));
  else {
    const config = (await jsonAt(path)) || {};
    if (tool === "opencode") { delete config.provider?.["lobakai"]; if (config.model?.startsWith("lobakai/")) delete config.model; }
    if (tool === "droid") config.customModels = (config.customModels || []).filter((item: any) => !item?.id?.startsWith("custom:LobakAI"));
    if (tool === "openclaw") delete config.models?.providers?.["lobakai"];
    if (tool === "cline") { delete config.openAiBaseUrl; delete config.openAiModelId; delete config.planModeOpenAiModelId; config.actModeApiProvider = "cline"; config.planModeApiProvider = "cline"; await writeJson(join(homeDir(), ".cline", "data", "secrets.json"), {}); }
    if (tool === "kilo") delete config["openai-compatible"];
    if (tool === "jcode") await writeText(join(homeDir(), ".config", "jcode", "provider-lobakai.env"), "");
    if (tool === "cowork") return writeJson(path, {}).then(() => ({ success: true, message: "Cowork config reset" }));
    if (tool === "claude" && config.env) { for (const key of ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_MAX_CONTEXT_TOKENS"]) delete config.env[key]; }
    await writeJson(path, config);
  }
  return { success: true, message: `${tool} settings removed successfully`, configPath: path };
}

export const CLI_TOOL_IDS = [...tools];

export function isCliToolId(value: string): value is CliTool {
  return tools.includes(value as CliTool);
}
