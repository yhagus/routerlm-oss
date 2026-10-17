// Embeddings provider adapter registry
import createOpenAIEmbeddingAdapter from "./openai.ts";
import openaiCompatNode from "./openaiCompatNode.ts";
import { customNodeType } from "../../providers/customNodes.ts";

const OPENAI_COMPAT_PROVIDERS = [
  "openai", "mistral", "voyage-ai",
  "jina-ai",
];

const ADAPTERS: Record<string, any> = {
  ...Object.fromEntries(OPENAI_COMPAT_PROVIDERS.map((id) => [id, createOpenAIEmbeddingAdapter(id)])),
};

export function getEmbeddingAdapter(provider: any): any {
  if (ADAPTERS[provider]) return ADAPTERS[provider];
  const nodeType = customNodeType(provider);
  if (nodeType === "openai-compatible" || nodeType === "custom-embedding") {
    return openaiCompatNode;
  }
  return null;
}
