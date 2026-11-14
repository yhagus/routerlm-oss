import type { ParameterPolicy, ParameterValues } from "@/db/schemas/index.js";
import {
  type InferenceRequest,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "./internal-format.js";

/** Every parameter a Parameter Policy can set, in a fixed order. */
export const POLICY_PARAMETERS = [
  "temperature",
  "topP",
  "maxOutputTokens",
  "reasoningEffort",
  "stopSequences",
] as const satisfies readonly (keyof ParameterValues)[];

type PolicyParameter = (typeof POLICY_PARAMETERS)[number];
type NumericParameter = "temperature" | "topP" | "maxOutputTokens";

/**
 * The request the upstream gets under this policy (spec "Inference path"
 * step 4): a forced value replaces the client's, a default fills what the
 * client omitted, a cap clamps whatever is left, and the system prompt goes
 * before the client's system content. Pure: the same request and policy
 * always give the same result, so the upstream bytes stay identical.
 */
export function applyParameterPolicy(
  request: InferenceRequest,
  policy: ParameterPolicy,
): InferenceRequest {
  const policed: InferenceRequest = {
    ...request,
    system: policy.systemPrompt
      ? [{ type: "text", text: policy.systemPrompt }, ...request.system]
      : request.system,
    temperature: numberUnderPolicy("temperature", request.temperature, policy),
    topP: numberUnderPolicy("topP", request.topP, policy),
    maxOutputTokens: numberUnderPolicy("maxOutputTokens", request.maxOutputTokens, policy),
    stopSequences:
      policy.forced?.stopSequences ?? request.stopSequences ?? policy.defaults?.stopSequences,
  };
  const reasoning = reasoningUnderPolicy(request.reasoning, policy);
  if (reasoning) {
    policed.reasoning = reasoning;
  }
  return policed;
}

/**
 * The policy for one Route: the Model's, except that every parameter the
 * Route override sets (as a default, forced value or cap) takes all its rules
 * from the override, and the override's system prompt, even an empty one,
 * replaces the Model's.
 */
export function effectiveParameterPolicy(
  modelPolicy: ParameterPolicy,
  routeOverride: ParameterPolicy | null,
): ParameterPolicy {
  if (!routeOverride) {
    return modelPolicy;
  }
  const effective: ParameterPolicy = {};
  for (const parameter of POLICY_PARAMETERS) {
    const source = setsParameter(routeOverride, parameter) ? routeOverride : modelPolicy;
    copyRules(source, effective, parameter);
  }
  const systemPrompt = routeOverride.systemPrompt ?? modelPolicy.systemPrompt;
  if (systemPrompt !== undefined) {
    effective.systemPrompt = systemPrompt;
  }
  return effective;
}

function numberUnderPolicy(
  parameter: NumericParameter,
  clientValue: number | undefined,
  { defaults, forced, caps }: ParameterPolicy,
): number | undefined {
  const value = forced?.[parameter] ?? clientValue ?? defaults?.[parameter];
  const cap = caps?.[parameter];
  if (value === undefined || cap === undefined) {
    return value;
  }
  return Math.min(value, cap);
}

/**
 * A forced effort replaces the client's whole reasoning setting (a thinking
 * budget included); a default applies only when the client asked for no
 * reasoning at all; a cap bounds an effort by the order of REASONING_EFFORTS.
 */
function reasoningUnderPolicy(
  clientReasoning: InferenceRequest["reasoning"],
  { defaults, forced, caps }: ParameterPolicy,
): InferenceRequest["reasoning"] {
  if (forced?.reasoningEffort) {
    return { effort: lowerEffort(forced.reasoningEffort, caps?.reasoningEffort) };
  }
  const reasoning =
    clientReasoning ??
    (defaults?.reasoningEffort ? { effort: defaults.reasoningEffort } : undefined);
  if (!reasoning?.effort) {
    return reasoning;
  }
  return { ...reasoning, effort: lowerEffort(reasoning.effort, caps?.reasoningEffort) };
}

function lowerEffort(effort: ReasoningEffort, cap: ReasoningEffort | undefined): ReasoningEffort {
  if (cap === undefined || REASONING_EFFORTS.indexOf(effort) <= REASONING_EFFORTS.indexOf(cap)) {
    return effort;
  }
  return cap;
}

function setsParameter(policy: ParameterPolicy, parameter: PolicyParameter): boolean {
  return (
    policy.defaults?.[parameter] !== undefined ||
    policy.forced?.[parameter] !== undefined ||
    (parameter !== "stopSequences" && policy.caps?.[parameter] !== undefined)
  );
}

function copyRules(from: ParameterPolicy, to: ParameterPolicy, parameter: PolicyParameter): void {
  const defaultValue = from.defaults?.[parameter];
  if (defaultValue !== undefined) {
    to.defaults = { ...to.defaults, [parameter]: defaultValue };
  }
  const forcedValue = from.forced?.[parameter];
  if (forcedValue !== undefined) {
    to.forced = { ...to.forced, [parameter]: forcedValue };
  }
  const cap = parameter === "stopSequences" ? undefined : from.caps?.[parameter];
  if (cap !== undefined) {
    to.caps = { ...to.caps, [parameter]: cap };
  }
}
