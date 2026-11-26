import type { ParameterCaps, ParameterPolicy, ParameterValues } from '@/db/schemas';
import { type InferenceRequest, REASONING_EFFORTS, type ReasoningEffort } from './internal-format';

export const POLICY_PARAMETERS = [
  'temperature',
  'topP',
  'maxOutputTokens',
  'reasoningEffort',
  'stopSequences',
  'serviceTier',
  'voice',
  'watermark',
] as const satisfies readonly (keyof ParameterValues)[];

type PolicyParameter = (typeof POLICY_PARAMETERS)[number];
type CappedParameter = Exclude<keyof ParameterCaps, 'reasoningBudgetTokens'>;
type NumericParameter = 'temperature' | 'topP' | 'maxOutputTokens';

export function applyParameterPolicy(
  request: InferenceRequest,
  policy: ParameterPolicy,
): InferenceRequest {
  const policed: InferenceRequest = {
    ...request,
    system: policy.systemPrompt
      ? [{ type: 'text', text: policy.systemPrompt }, ...request.system]
      : request.system,
    temperature: numberUnderPolicy('temperature', request.temperature, policy),
    topP: numberUnderPolicy('topP', request.topP, policy),
    maxOutputTokens: numberUnderPolicy('maxOutputTokens', request.maxOutputTokens, policy),
    stopSequences:
      policy.forced?.stopSequences ?? request.stopSequences ?? policy.defaults?.stopSequences,
    serviceTier: policy.forced?.serviceTier ?? request.serviceTier ?? policy.defaults?.serviceTier,
  };
  const reasoning = reasoningUnderPolicy(request.reasoning, policy);
  if (reasoning) {
    policed.reasoning = reasoning;
  }
  return policed;
}

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
  const reasoningBudgetCap =
    routeOverride.caps?.reasoningBudgetTokens ?? modelPolicy.caps?.reasoningBudgetTokens;
  if (reasoningBudgetCap !== undefined) {
    effective.caps = { ...effective.caps, reasoningBudgetTokens: reasoningBudgetCap };
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

function reasoningUnderPolicy(
  clientReasoning: InferenceRequest['reasoning'],
  { defaults, forced, caps }: ParameterPolicy,
): InferenceRequest['reasoning'] {
  if (forced?.reasoningEffort) {
    return { effort: lowerEffort(forced.reasoningEffort, caps?.reasoningEffort) };
  }
  const reasoning =
    clientReasoning ??
    (defaults?.reasoningEffort ? { effort: defaults.reasoningEffort } : undefined);
  if (!reasoning) {
    return reasoning;
  }
  const policed = { ...reasoning };
  if (policed.effort) {
    policed.effort = lowerEffort(policed.effort, caps?.reasoningEffort);
  }
  const budgetCap = caps?.reasoningBudgetTokens;
  if (policed.budgetTokens !== undefined && budgetCap !== undefined) {
    policed.budgetTokens = Math.min(policed.budgetTokens, budgetCap);
  }
  return policed;
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
    (isCapped(parameter) && policy.caps?.[parameter] !== undefined)
  );
}

function isCapped(parameter: PolicyParameter): parameter is CappedParameter {
  return (
    parameter !== 'stopSequences' &&
    parameter !== 'serviceTier' &&
    parameter !== 'voice' &&
    parameter !== 'watermark'
  );
}

export function isWatermarkedUnder({ defaults, forced }: ParameterPolicy): boolean {
  return forced?.watermark ?? defaults?.watermark ?? false;
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
  const cap = isCapped(parameter) ? from.caps?.[parameter] : undefined;
  if (cap !== undefined) {
    to.caps = { ...to.caps, [parameter]: cap };
  }
}
