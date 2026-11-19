// The Parameter Policy on a Model or a Route override, and the editor's form for it.

/** Ordered from least to most reasoning, as the backend caps them. */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** The gateway's Service Tier names; each Provider maps them to its own wire values. */
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
  /** Cap only: the backend rejects it as a default or forced value. */
  reasoningBudgetTokens?: number;
  stopSequences?: string[];
  serviceTier?: ServiceTier;
  /** Forced only: a speech request always names a voice, so a default never applies. */
  voice?: string;
  /** Whether a media Provider marks what it generates; off when not set. */
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
  /** Plain text placed before the client's system content; never a template. */
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

/** Stop sequences, Service Tiers, voices and watermarks have no order, so they can't be capped. */
export function isCappable(parameter: PolicyParameter): parameter is keyof ParameterCaps {
  return (
    parameter !== "stopSequences" &&
    parameter !== "serviceTier" &&
    parameter !== "voice" &&
    parameter !== "watermark"
  );
}

/** A thinking budget has no default or forced value; only a Cap limits it. */
export function isCapOnly(parameter: PolicyParameter): boolean {
  return parameter === "reasoningBudgetTokens";
}

/** Whether the editor offers `parameter` as a rule of `kind`. */
export function isRuleOffered(parameter: PolicyParameter, kind: RuleKind): boolean {
  if (kind === "caps") return isCappable(parameter);
  if (isCapOnly(parameter)) return false;
  // The backend takes a default voice but never applies it, so it isn't offered.
  return !(kind === "defaults" && parameter === "voice");
}

/** The editor's inputs as text: an empty field means "not set". */
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

/** The allowed range of a numeric parameter, or undefined for the others. */
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

/** The policy the form describes, or the first problem that stops it from being saved. */
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

/** Labels of the Caps set without a default beside them: the parameter then stays omitted. */
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

/** Parses one field into `values`; returns what is wrong with it, if anything. */
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

/** A default or forced value above its cap could never be sent as set. */
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
