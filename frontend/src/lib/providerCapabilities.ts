export type ThinkingFormat =
  | "openai"
  | "claude-adaptive"
  | "claude-budget"
  | "gemini-level"
  | "gemini-budget"
  | "zai"
  | "qwen"
  | "deepseek"
  | "kimi"
  | "minimax"
  | "hunyuan"
  | "step";

export interface ModelCapabilities {
  vision: boolean;
  pdf: boolean;
  audioInput: boolean;
  videoInput: boolean;
  imageOutput: boolean;
  audioOutput: boolean;
  search: boolean;
  tools: boolean;
  reasoning: boolean;
  thinkingFormat: ThinkingFormat | null;
  thinkingCanDisable: boolean;
  contextWindow: number;
  maxOutput: number;
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  vision: false,
  pdf: false,
  audioInput: false,
  videoInput: false,
  imageOutput: false,
  audioOutput: false,
  search: false,
  tools: true,
  reasoning: false,
  thinkingFormat: null,
  thinkingCanDisable: true,
  contextWindow: 200_000,
  maxOutput: 64_000,
};

const providerCapabilities: Record<
  string,
  Record<string, Partial<ModelCapabilities>>
> = {
  codex: {
    "gpt-5.6-sol": { vision: true, reasoning: true, search: true, thinkingFormat: "openai" },
    "gpt-5.6-sol-review": { vision: true, reasoning: true, search: true, thinkingFormat: "openai" },
    "gpt-5.6-terra": { vision: true, reasoning: true, search: true, thinkingFormat: "openai" },
    "gpt-5.6-terra-review": { vision: true, reasoning: true, search: true, thinkingFormat: "openai" },
    "gpt-5.6-luna": { vision: true, reasoning: true, search: true, thinkingFormat: "openai" },
    "gpt-5.6-luna-review": { vision: true, reasoning: true, search: true, thinkingFormat: "openai" },
  },
};

type PatternCapability = { pattern: string; caps: Partial<ModelCapabilities> };

const patternCapabilities: PatternCapability[] = [
  {
    pattern: "*claude*opus-5*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*opus-4.6*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*opus-4.7*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*opus-4.8*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*sonnet-4.6*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*sonnet-4.7*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*haiku*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },
  {
    pattern: "*claude*opus*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },
  {
    pattern: "*claude*sonnet*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },
  {
    pattern: "*claude*fable*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },
  {
    pattern: "*claude*mythos*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },
  {
    pattern: "*claude*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },
  {
    pattern: "*gemini-3*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
    },
  },
  {
    pattern: "*gemini-2.5*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "gemini-budget",
    },
  },
  {
    pattern: "*gemini*",
    caps: { vision: true, search: true, contextWindow: 1_048_576 },
  },
  { pattern: "*gpt-5*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai" } },
  { pattern: "*gpt-4o*", caps: { vision: true, search: true, contextWindow: 128_000, maxOutput: 16_384 } },
  { pattern: "*gpt-4.1*", caps: { vision: true, contextWindow: 1_000_000, maxOutput: 32_768 } },
  { pattern: "*gpt-4-turbo*", caps: { vision: true, contextWindow: 128_000 } },
  { pattern: "*gpt-4*", caps: { contextWindow: 128_000 } },
  { pattern: "*o1*", caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200_000, maxOutput: 100_000 } },
  { pattern: "*o3*", caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200_000, maxOutput: 100_000 } },
  { pattern: "*o4*", caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200_000, maxOutput: 100_000 } },
  { pattern: "*qwen*vl*", caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262_144 } },
  { pattern: "*qwen*omni*", caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262_144, maxOutput: 65_536 } },
  { pattern: "*qwen3.5*", caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1_000_000, maxOutput: 65_536 } },
  { pattern: "*qwen3.6*", caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1_000_000, maxOutput: 65_536 } },
  { pattern: "*qwen3.7*", caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1_000_000, maxOutput: 65_536 } },
  { pattern: "*qwen3*", caps: { reasoning: true, thinkingFormat: "qwen" } },
  { pattern: "*qmodel*", caps: { reasoning: true, thinkingFormat: "qwen" } },
  {
    pattern: "*dmodel*",
    caps: { reasoning: true, thinkingFormat: "deepseek" },
  },
  {
    pattern: "*deepseek*reasoner*",
    caps: { reasoning: true, thinkingFormat: "deepseek" },
  },
  {
    pattern: "*deepseek*r1*",
    caps: { reasoning: true, thinkingFormat: "deepseek" },
  },
  { pattern: "*glm-5*", caps: { reasoning: true, thinkingFormat: "zai" } },
  { pattern: "*glm-4.6v*", caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "zai" } },
  { pattern: "*glm-4.5v*", caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "zai" } },
  {
    pattern: "*minimax-m3*",
    caps: { vision: true, reasoning: true, thinkingFormat: "minimax" },
  },
  {
    pattern: "*minimax*",
    caps: {
      vision: true,
      reasoning: true,
      thinkingFormat: "minimax",
      thinkingCanDisable: false,
    },
  },
  {
    pattern: "*hunyuan*",
    caps: { reasoning: true, thinkingFormat: "hunyuan" },
  },
  { pattern: "hy3*", caps: { reasoning: true, thinkingFormat: "hunyuan" } },
  { pattern: "*step-*", caps: { reasoning: true, thinkingFormat: "step" } },
  { pattern: "*laguna*", caps: { reasoning: true, thinkingFormat: "openai" } },
  { pattern: "*grok*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai" } },
  { pattern: "*sonar*", caps: { search: true } },
  { pattern: "*perplexity*", caps: { search: true } },
  { pattern: "*muse-spark*", caps: { vision: true, reasoning: true, thinkingFormat: "openai" } },
];

export function matchPattern(pattern: string, model: string): boolean {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`, "i").test(model);
}

function mergeCapabilities(
  caps: Partial<ModelCapabilities> = {},
): ModelCapabilities {
  return { ...DEFAULT_CAPABILITIES, ...caps };
}

export function getCapabilitiesForModel(
  provider: string,
  model: string,
): ModelCapabilities {
  if (!model) return mergeCapabilities();
  const baseModel = model.includes("/")
    ? model.split("/").pop() || model
    : model;
  const exact =
    providerCapabilities[provider]?.[model] ||
    providerCapabilities[provider]?.[baseModel];
  if (exact) return mergeCapabilities(exact);

  const match = patternCapabilities.find(
    ({ pattern }) =>
      matchPattern(pattern, baseModel) || matchPattern(pattern, model),
  );
  return mergeCapabilities(match?.caps);
}
