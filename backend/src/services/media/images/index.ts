// Image provider adapter registry
import createOpenAIAdapter from "./openai.ts";
import codex from "./codex.ts";
import sdwebui from "./sdwebui.ts";
import comfyui from "./comfyui.ts";
import huggingface from "./huggingface.ts";
import nanobanana from "./nanobanana.ts";
import falAi from "./falAi.ts";
import stabilityAi from "./stabilityAi.ts";
import blackForestLabs from "./blackForestLabs.ts";
import runwayml from "./runwayml.ts";
import antigravity from "./antigravity.ts";
import codebuddyIntlCli from "./codebuddy-intl-cli.ts";

const ADAPTERS: Record<string, any> = {
  openai: createOpenAIAdapter("openai"),
  recraft: createOpenAIAdapter("recraft"),
  codex,
  sdwebui,
  comfyui,
  huggingface,
  nanobanana,
  antigravity,
  "codebuddy-intl-cli": codebuddyIntlCli,
  "fal-ai": falAi,
  "stability-ai": stabilityAi,
  "black-forest-labs": blackForestLabs,
  runwayml,
};

export function getImageAdapter(provider: any): any {
  return ADAPTERS[provider] || null;
}

export function isImageProvider(provider: any) {
  return provider in ADAPTERS;
}
