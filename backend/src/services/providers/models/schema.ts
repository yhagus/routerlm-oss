import { deriveModelName } from "./namePatterns.ts";

// Model defaults centralized (was scattered as `m.kind || "llm"`, `quotaFamily || "normal"`, etc.)
export const MODEL_DEFAULTS = {
  kind: "llm",
  quotaFamily: "normal",
  strip: [] as any[],
  targetFormat: null
};

// Normalize a registry model entry: accept terse "id" string, fill name via regex when omitted.
// Override always wins (raw spread last); name falls back to regex → id.
export function normalizeModel(raw: any) {
  const model = typeof raw === "string" ? { id: raw } : raw;
  if (model.name !== undefined) return model;
  return { ...model, name: deriveModelName(model.id) };
}

// Resolve model kind with default (accepts legacy `type` field)
export function modelKind(model: any) {
  return model?.kind || model?.type || MODEL_DEFAULTS.kind;
}
export function modelQuotaFamily(model: any) {
  return model?.quotaFamily || MODEL_DEFAULTS.quotaFamily;
}
export function modelStrip(model: any) {
  return model?.strip || [];
}
export function modelTargetFormat(model: any) {
  return model?.targetFormat || MODEL_DEFAULTS.targetFormat;
}
