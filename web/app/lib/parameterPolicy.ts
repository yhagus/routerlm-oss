// The Parameter Policy on a Model or a Route override, and the editor's form for it.

/** Ordered from least to most reasoning, as the backend caps them. */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ParameterValues {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  stopSequences?: string[];
}

export type ParameterCaps = Omit<ParameterValues, "stopSequences">;

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
  { name: "stopSequences", label: "Stop sequences", hint: "One per line" },
];

export const RULE_KINDS: { kind: RuleKind; label: string }[] = [
  { kind: "defaults", label: "Default" },
  { kind: "forced", label: "Forced" },
  { kind: "caps", label: "Cap" },
];

/** Stop sequences have no order, so they can't be capped. */
export function isCappable(parameter: PolicyParameter): boolean {
  return parameter !== "stopSequences";
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
} as const;

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
      if (text === "" || (kind === "caps" && !isCappable(name))) continue;
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

export function isEmptyPolicy(policy: ParameterPolicy): boolean {
  return Object.keys(policy).length === 0;
}

function rowFromValues(values: ParameterValues | undefined): Record<PolicyParameter, string> {
  return {
    temperature: values?.temperature?.toString() ?? "",
    topP: values?.topP?.toString() ?? "",
    maxOutputTokens: values?.maxOutputTokens?.toString() ?? "",
    reasoningEffort: values?.reasoningEffort ?? "",
    stopSequences: values?.stopSequences?.join("\n") ?? "",
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
      if (name === "stopSequences") continue;
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
