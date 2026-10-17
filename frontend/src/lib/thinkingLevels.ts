import {
  getCapabilitiesForModel,
  matchPattern,
} from "./providerCapabilities";

const LEVELS = {
  base: ["none", "low", "medium", "high"],
  onOff: ["none", "thinking"],
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],
  levelMax: ["none", "low", "medium", "high", "max"],
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],
  gemini: ["minimal", "low", "medium", "high"],
  hiMax: ["none", "high", "max"],
} as const;

const formatLevels: Record<string, readonly string[]> = {
  openai: LEVELS.openai,
  "claude-adaptive": LEVELS.levelMax,
  "claude-budget": LEVELS.budgetX,
  "gemini-level": LEVELS.gemini,
  "gemini-budget": LEVELS.base,
  zai: LEVELS.onOff,
  qwen: LEVELS.base,
  kimi: LEVELS.levelMax,
  deepseek: LEVELS.hiMax,
  minimax: LEVELS.onOff,
  hunyuan: LEVELS.base,
  step: LEVELS.base,
};

const overrides = [
  {
    pattern: "*gpt-5.6-sol*",
    levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
  },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] },
];

export function getThinkingLevels(
  provider: string,
  model: string,
): string[] | null {
  const caps = getCapabilitiesForModel(provider, model);
  if (!caps.reasoning) return null;
  const override = overrides.find(({ pattern }) =>
    matchPattern(pattern, model),
  );
  let levels = [
    ...(override?.levels ||
      formatLevels[caps.thinkingFormat || ""] ||
      LEVELS.base),
  ];
  if (!caps.thinkingCanDisable)
    levels = levels.filter((level) => level !== "none");
  return levels;
}

export function resolveThinkingSuffix(
  provider: string,
  model: string,
  level: string,
): string | null {
  if (!level || level === "auto") return null;
  return getThinkingLevels(provider, model)?.includes(level) ? level : null;
}
