import type { Runtime } from "../../runtime";
import type { Repositories } from "../../db/repositories";
import { getProviderMetadata, resolveProviderId } from "./providerCatalog";
// The v1 capabilities resolver is the source of truth for built-in model caps
// (vision/reasoning/context windows) surfaced by the dashboard models API.
import { getCapabilitiesForModel } from "./capabilities.ts";

const LLM_KIND = "llm";

function valueJson(value: unknown, fallback: any): any {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function modelKind(model: Record<string, unknown>): string {
  return String(model.kind || model.type || LLM_KIND);
}

function modelCapabilities(model: Record<string, unknown>): Record<string, unknown> {
  const caps = model.capabilities && typeof model.capabilities === "object" ? model.capabilities as Record<string, unknown> : {};
  const params = Array.isArray(model.params) ? model.params.map(String) : [];
  return { ...caps, ...(params.length ? { params } : {}) };
}

// v1 /api/models attaches getCapabilitiesForModel(provider, model) caps to
// every built-in row so the dashboard can render capacity badges and default
// context windows even when no override is stored.
function builtInModelCapabilities(providerId: string, modelId: string, model: Record<string, unknown>): Record<string, unknown> {
  try {
    const resolved = getCapabilitiesForModel(providerId, modelId) as Record<string, unknown>;
    const { thinkingFormat, thinkingCanDisable, thinkingRange, ...rest } = resolved || {};
    return { ...rest, ...modelCapabilities(model) };
  } catch {
    return modelCapabilities(model);
  }
}

function disabledModels(runtime: Runtime): Record<string, string[]> {
  const rows = runtime.sqlite.query("SELECT key, value FROM kv WHERE scope = 'disabledModels'").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, valueJson(row.value, [])]));
}

function contextWindows(runtime: Runtime): Record<string, number> {
  const rows = runtime.sqlite.query("SELECT key, value FROM kv WHERE scope = 'modelContextWindows'").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.flatMap((row) => {
    const value = Number(valueJson(row.value, 0));
    return Number.isFinite(value) && value > 0 ? [[row.key, Math.min(Math.floor(value), 2_000_000)]] : [];
  }));
}

function isDisabled(disabled: Record<string, string[]>, aliases: string[], model: string): boolean {
  return aliases.some((alias) => Array.isArray(disabled[alias]) && disabled[alias].includes(model));
}

export function modelManagementCatalog(runtime: Runtime): Record<string, unknown>[] {
  const ctx = catalogContext(runtime);
  return runtime.repos.models.catalog()
    .filter((model) => modelKind(model) === LLM_KIND)
    .map((model) => catalogEntry(model, ctx))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

export function searchModelCatalog(
  runtime: Runtime,
  input: { query?: string; provider?: string; kind?: string; limit?: number },
): Record<string, unknown>[] {
  const ctx = catalogContext(runtime);
  const kind = input.kind || LLM_KIND;
  return runtime.repos.models.search({ ...input, kind })
    .map((model) => catalogEntry(model, ctx))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function catalogContext(runtime: Runtime): {
  aliases: Record<string, string>;
  disabled: Record<string, string[]>;
  windows: Record<string, number>;
} {
  return {
    aliases: runtime.repos.aliases.list(),
    disabled: disabledModels(runtime),
    windows: contextWindows(runtime),
  };
}

// Map one catalog row to the dashboard model shape. Disabled models are
// skipped here (disabled state lives in the kv disabledModels scope).
function catalogEntry(
  model: Record<string, unknown>,
  ctx: { aliases: Record<string, string>; disabled: Record<string, string[]>; windows: Record<string, number> },
): Record<string, unknown> | null {
  const id = String(model.modelId || "");
  if (!id) return null;
  const alias = String(model.providerAlias || "");
  const provider = String(model.provider || "");
  if (isDisabled(ctx.disabled, [alias, provider], id)) return null;
  const fullModel = `${alias}/${id}`;
  const kind = modelKind(model);
  const entry: Record<string, unknown> = {
    id: fullModel,
    provider,
    model: id,
    name: String(model.name || id),
    fullModel,
    routedModel: fullModel,
    alias: ctx.aliases[fullModel] || id,
    disabled: false,
    kind,
  };
  if (model.source === "registry") {
    entry.caps = {
      ...builtInModelCapabilities(provider, id, { capabilities: (model.capabilities as Record<string, unknown>) || {}, params: [] as any[]}),
      ...(ctx.windows[fullModel] ? { contextWindow: ctx.windows[fullModel] } : {}),
    };
  }
  return entry;
}


export function gatewayModels(repos: Repositories, sqlite: { query(sql: string): { all(): unknown[] } }, kind = "llm"): Record<string, unknown>[] {
  const disabled = disabledModels({ repos, sqlite } as Runtime);
  const seen = new Set<string>();
  const models: Record<string, unknown>[] = [];
  const add = (id: string, ownedBy: string, modelKindValue = LLM_KIND) => {
    if (!id || (kind !== "chat" && kind !== modelKindValue) || seen.has(id)) return;
    seen.add(id);
    models.push({ id, object: "model", owned_by: ownedBy, created: Math.floor(Date.now() / 1000) });
  };

  for (const connection of repos.providers.list()) {
    const metadata = getProviderMetadata(connection.provider);
    const alias = String(connection.data.prefix || metadata?.alias || connection.provider);
    const configured = Array.isArray(connection.data.models) ? connection.data.models.map(String) : [];
    const source = configured.length ? configured.map((id) => ({ id })) : metadata?.models || [];
    for (const model of source) {
      const id = String(model.id || "");
      const entryKind = modelKind(model);
      if (!isDisabled(disabled, [alias, connection.provider], id)) add(`${alias}/${id}`, alias, entryKind);
    }
  }
  for (const model of repos.models.catalog()) {
    if (model.disabled) continue;
    const id = String(model.id || model.model || "");
    const provider = String(model.providerAlias || model.provider || "custom");
    const fullId = id.includes("/") ? id : `${provider}/${id}`;
    add(fullId, provider, modelKind(model));
  }
  return models;
}

function comboCapabilities(combo: Record<string, unknown>, runtime?: Runtime): Record<string, unknown> {
  const raw = String(combo.capabilities || "{}");
  let stored: Record<string, unknown> = {};
  try { stored = JSON.parse(raw); } catch { stored = {}; }

  // Auto-derive modality capabilities from member models so clients (e.g. OpenCode)
  // that check /v1/models before sending images don't strip them client-side.
  let models: string[] = [];
  if (Array.isArray(combo.models)) models = combo.models as string[];
  else if (typeof combo.models === "string") { try { models = JSON.parse(combo.models); } catch { models = []; } }
  if (models.length && runtime) {
    const capsOf = (modelStr: string): Record<string, unknown> => {
      const slash = typeof modelStr === "string" ? modelStr.indexOf("/") : -1;
      const provider = slash > 0 ? modelStr.slice(0, slash) : "";
      const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;
      return getCapabilitiesForModel(provider, model) as Record<string, unknown>;
    };
    const modalityKeys = ["vision", "pdf", "audioInput", "videoInput"] as const;
    for (const key of modalityKeys) {
      if (stored[key] === true) continue;
      if (models.some((m) => capsOf(m)[key] === true)) stored[key] = true;
    }
  }
  return stored;
}

export function publicModels(runtime: Runtime, apiKey: { comboAccessMode: string; comboAccessList: string[]; modelAccessMode?: string; modelAccessList?: string[] } | null, kind = "llm"): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  // Direct models follow the model access gate; an empty whitelist blocks
  // every direct model (see the key editor copy in EndpointView).
  const allowedModel = (ids: string[]) => {
    if (!apiKey) return true;
    if (apiKey.modelAccessMode === "blacklist") return ids.every((id) => !apiKey.modelAccessList!.includes(id));
    return ids.some((id) => apiKey.modelAccessList!.includes(id));
  };
  const add = (model: Record<string, unknown>, allowed = allowedModel([String(model.id || "")])) => {
    const id = String(model.id || "");
    if (id && allowed && !seen.has(id)) {
      seen.add(id);
      output.push(model);
    }
  };

  for (const model of runtime.gateway.models(kind)) add(model);
  const aliases = runtime.repos.aliases.list();
  for (const [alias, target] of Object.entries(aliases as Record<string, any>)) {
    const source = runtime.gateway.models(kind).find((model) => model.id === target);
    if (source) add({ ...source, id: alias, root_model: target }, allowedModel([alias, target]));
  }
  for (const combo of runtime.repos.combos.list()) {
    const name = String(combo.name || "");
    // v1 comboMatchesKinds: a combo appears only in lists matching its kind.
    const comboKind = String(combo.kind || LLM_KIND);
    const kindMatches = kind === "webSearch" || kind === "webFetch"
      ? comboKind === kind
      : comboKind === kind;
    if (!kindMatches) continue;
    // Combo names follow the combo access gate only; the model access gate
    // applies to direct model requests (combo members bypass it).
    const allowed = !apiKey || apiKey.comboAccessMode !== "whitelist" || apiKey.comboAccessList.includes(name);
    const blocked = apiKey?.comboAccessMode === "blacklist" && apiKey.comboAccessList.includes(name);
    if (name && allowed && !blocked) add({ id: name, object: "model", capabilities: comboCapabilities(combo, runtime) }, true);
  }
  return output;
}

export function normalizeProviderModel(provider: string, model: string): { provider: string; model: string } {
  const resolved = resolveProviderId(provider);
  const metadata = getProviderMetadata(resolved);
  return { provider: metadata?.alias || provider, model };
}
