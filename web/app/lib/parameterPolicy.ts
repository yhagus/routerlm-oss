export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const SERVICE_TIERS = ["fast", "flex"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

export const SERVICE_TIER_LABELS: Record<ServiceTier, string> = {
  fast: "Fast",
  flex: "Flex",
};

export interface ParameterValues {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  reasoningBudgetTokens?: number;
  stopSequences?: string[];
  serviceTier?: ServiceTier;
  voice?: string;
  watermark?: boolean;
}

export type ParameterCaps = Omit<
  ParameterValues,
  "stopSequences" | "serviceTier" | "voice" | "watermark"
>;

export interface ParameterPolicy {
  defaults?: ParameterValues;
  forced?: ParameterValues;
  caps?: ParameterCaps;
  systemPrompt?: string;
}

export type PolicyParameter = keyof ParameterValues;
export type RuleKind = "defaults" | "forced" | "caps";

export const POLICY_PARAMETERS: { name: PolicyParameter; label: string; hint: string }[] = [
  { name: "temperature", label: "Temperature", hint: "0 to 2" },
  { name: "topP", label: "Top P", hint: "0 to 1" },
  { name: "maxOutputTokens", label: "Max output tokens", hint: "Whole number" },
  { name: "reasoningEffort", label: "Reasoning effort", hint: "None to xhigh" },
  {
    name: "reasoningBudgetTokens",
    label: "Thinking budget",
    hint: "Whole number of tokens, Cap only",
  },
  { name: "stopSequences", label: "Stop sequences", hint: "One per line" },
  { name: "serviceTier", label: "Service tier", hint: "Dropped where unsupported" },
  { name: "voice", label: "Voice", hint: "Speech, Forced only" },
  { name: "watermark", label: "Watermark", hint: "Media Kinds, off when not set" },
];

export const RULE_KINDS: { kind: RuleKind; label: string }[] = [
  { kind: "defaults", label: "Default" },
  { kind: "forced", label: "Forced" },
  { kind: "caps", label: "Cap" },
];

export function isCappable(parameter: PolicyParameter): parameter is keyof ParameterCaps {
  return (
    parameter !== "stopSequences" &&
    parameter !== "serviceTier" &&
    parameter !== "voice" &&
    parameter !== "watermark"
  );
}

export function isCapOnly(parameter: PolicyParameter): boolean {
  return parameter === "reasoningBudgetTokens";
}

export function isRuleOffered(parameter: PolicyParameter, kind: RuleKind): boolean {
  if (kind === "caps") return isCappable(parameter);
  if (isCapOnly(parameter)) return false;
  return !(kind === "defaults" && parameter === "voice");
}

export interface PolicyForm {
  rules: Record<RuleKind, Record<PolicyParameter, string>>;
  systemPrompt: string;
}

const NUMBER_RANGES = {
  temperature: { min: 0, max: 2, isWhole: false },
  topP: { min: 0, max: 1, isWhole: false },
  maxOutputTokens: { min: 1, max: Number.MAX_SAFE_INTEGER, isWhole: true },
  reasoningBudgetTokens: { min: 1, max: Number.MAX_SAFE_INTEGER, isWhole: true },
} as const;

export function numberRange(
  parameter: PolicyParameter,
): { min: number; max: number; isWhole: boolean } | undefined {
  switch (parameter) {
    case "temperature":
    case "topP":
    case "maxOutputTokens":
    case "reasoningBudgetTokens":
      return NUMBER_RANGES[parameter];
    default:
      return undefined;
  }
}

export function formFromPolicy(policy: ParameterPolicy | null): PolicyForm {
  const rules = {
    defaults: rowFromValues(policy?.defaults),
    forced: rowFromValues(policy?.forced),
    caps: rowFromValues(policy?.caps),
  };
  return { rules, systemPrompt: policy?.systemPrompt ?? "" };
}

export function policyFromForm(
  form: PolicyForm,
): { policy: ParameterPolicy } | { problem: string } {
  const policy: ParameterPolicy = {};
  for (const { kind, label } of RULE_KINDS) {
    const values: ParameterValues = {};
    for (const { name, label: parameterLabel } of POLICY_PARAMETERS) {
      const text = form.rules[kind][name].trim();
      if (text === "") continue;
      if (!isRuleOffered(name, kind)) continue;
      const problem = setValue(values, name, text);
      if (problem) return { problem: `${label} ${parameterLabel.toLowerCase()}: ${problem}` };
    }
    if (Object.keys(values).length > 0) policy[kind] = values;
  }
  const problem = capProblem(policy);
  if (problem) return { problem };
  if (form.systemPrompt.trim() !== "") policy.systemPrompt = form.systemPrompt;
  return { policy };
}

export function capsWithoutDefault(form: PolicyForm): string[] {
  return POLICY_PARAMETERS.filter(
    ({ name }) =>
      isCappable(name) &&
      form.rules.caps[name].trim() !== "" &&
      (isCapOnly(name) || form.rules.defaults[name].trim() === ""),
  ).map(({ label }) => label);
}

export function isEmptyPolicy(policy: ParameterPolicy): boolean {
  return Object.keys(policy).length === 0;
}

function rowFromValues(values: ParameterValues | undefined): Record<PolicyParameter, string> {
  return {
    temperature: values?.temperature?.toString() ?? "",
    topP: values?.topP?.toString() ?? "",
    maxOutputTokens: values?.maxOutputTokens?.toString() ?? "",
    reasoningBudgetTokens: values?.reasoningBudgetTokens?.toString() ?? "",
    reasoningEffort: values?.reasoningEffort ?? "",
    stopSequences: values?.stopSequences?.join("\n") ?? "",
    serviceTier: values?.serviceTier ?? "",
    voice: values?.voice ?? "",
    watermark: values?.watermark === undefined ? "" : String(values.watermark),
  };
}

function setValue(values: ParameterValues, parameter: PolicyParameter, text: string): string {
  if (parameter === "stopSequences") {
    values.stopSequences = text.split("\n").filter((line) => line !== "");
    return "";
  }
  if (parameter === "reasoningEffort") {
    const effort = REASONING_EFFORTS.find((known) => known === text);
    if (!effort) return `use one of ${REASONING_EFFORTS.join(", ")}`;
    values.reasoningEffort = effort;
    return "";
  }
  if (parameter === "serviceTier") {
    const tier = SERVICE_TIERS.find((known) => known === text);
    if (!tier) return `use one of ${SERVICE_TIERS.join(", ")}`;
    values.serviceTier = tier;
    return "";
  }
  if (parameter === "voice") {
    values.voice = text;
    return "";
  }
  if (parameter === "watermark") {
    if (text !== "true" && text !== "false") return "use on or off";
    values.watermark = text === "true";
    return "";
  }
  const { min, max, isWhole } = NUMBER_RANGES[parameter];
  const value = Number(text);
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (isWhole && !Number.isInteger(value))
  ) {
    return isWhole ? "use a whole number above 0" : `use a number from ${min} to ${max}`;
  }
  values[parameter] = value;
  return "";
}

function capProblem(policy: ParameterPolicy): string {
  for (const kind of ["defaults", "forced"] as const) {
    for (const { name, label } of POLICY_PARAMETERS) {
      if (!isCappable(name)) continue;
      const value = policy[kind]?.[name];
      const cap = policy.caps?.[name];
      if (value !== undefined && cap !== undefined && rank(value) > rank(cap)) {
        const kindLabel = kind === "defaults" ? "default" : "forced";
        return `The ${kindLabel} ${label.toLowerCase()} (${value}) is above its cap (${cap}).`;
      }
    }
  }
  return "";
}

function rank(value: number | ReasoningEffort): number {
  return typeof value === "number" ? value : REASONING_EFFORTS.indexOf(value);
}
