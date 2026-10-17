export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
export const CUSTOM_EMBEDDING_PREFIX = "custom-embedding-";

export type CustomNodeType = "openai-compatible" | "anthropic-compatible" | "custom-embedding";
type CustomNodeRow = { id: unknown; type: unknown; apiType?: unknown };

// Custom node ids are user-chosen, so the node kind comes from providerNodes
// rows, not from the id. The db layer registers the loader and invalidates the
// cache on every write. Ids created before free ids still resolve by prefix.
let loadCustomNodes: (() => CustomNodeRow[]) | null = null;
let customNodes: Map<string, { type: CustomNodeType; apiType: string | null }> | null = null;

export function registerCustomNodeLoader(loader: () => CustomNodeRow[]) {
  loadCustomNodes = loader;
  customNodes = null;
}

export function invalidateCustomNodes() {
  customNodes = null;
}

function isCustomNodeType(value: unknown): value is CustomNodeType {
  return value === "openai-compatible" || value === "anthropic-compatible" || value === "custom-embedding";
}

function customNodeMap() {
  if (!customNodes) {
    customNodes = new Map();
    for (const row of loadCustomNodes?.() || []) {
      if (!isCustomNodeType(row.type)) continue;
      customNodes.set(String(row.id), { type: row.type, apiType: typeof row.apiType === "string" ? row.apiType : null });
    }
  }
  return customNodes;
}

export function customNodeType(providerId: unknown): CustomNodeType | null {
  if (typeof providerId !== "string") return null;
  const node = customNodeMap().get(providerId);
  if (node) return node.type;
  if (providerId.startsWith(OPENAI_COMPATIBLE_PREFIX)) return "openai-compatible";
  if (providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX)) return "anthropic-compatible";
  if (providerId.startsWith(CUSTOM_EMBEDDING_PREFIX)) return "custom-embedding";
  return null;
}

export function openAICompatibleApiType(providerId: unknown): "chat" | "responses" {
  if (customNodeType(providerId) !== "openai-compatible") return "chat";
  const apiType = customNodeMap().get(providerId as string)?.apiType;
  if (apiType) return apiType === "responses" ? "responses" : "chat";
  return (providerId as string).includes("responses") ? "responses" : "chat";
}
