import type { ModelGroupRef } from '~/lib/modelGroups';
import type { ParameterPolicy } from '~/lib/parameterPolicy';
import type { Capability, ModelKind } from '~/lib/upstream';

export interface ModelSummary {
  id: string;
  name: string;
  displayName: string | null;
  kind: ModelKind;
  isEnabled: boolean;
  routeCount: number;
  createdAt: string;
  groups: ModelGroupRef[];
}

export interface RouteSummary {
  id: string;
  priority: number;
  isEnabled: boolean;
  parameterPolicyOverride: ParameterPolicy | null;
  provider: { id: string; slug: string; name: string; isEnabled: boolean };
  upstreamModel: {
    id: string;
    upstreamModelId: string;
    capabilities: Capability[];
    isEnabled: boolean;
  };
  enabledProviderAccountCount: number;
}

export interface ModelDetail {
  id: string;
  name: string;
  displayName: string | null;
  kind: ModelKind;
  isEnabled: boolean;
  parameterPolicy: ParameterPolicy;
  hasAutomaticCacheBreakpoints: boolean;
  createdAt: string;
  updatedAt: string;
  groups: ModelGroupRef[];
  routes: RouteSummary[];
}

export const DISPLAY_NAME_MAX_LENGTH = 100;

export interface NamedModel {
  name: string;
  displayName: string | null;
}

export interface ModelLabel {
  label: string;
  note?: string;
}

export function modelLabelOf(model: NamedModel, identity: string = model.name): ModelLabel {
  if (!model.displayName) return { label: identity };
  return { label: model.displayName, note: identity };
}

export function modelOptionOf(model: NamedModel & { id: string }): ModelLabel & { value: string } {
  return { value: model.id, ...modelLabelOf(model) };
}

export function recordedModelLabelOf(
  record: { modelId: string | null; modelName: string | null },
  currentModels: ReadonlyMap<string, NamedModel>,
  noModelText: string,
): ModelLabel {
  if (record.modelName === null) return { label: record.modelId ? 'Deleted Model' : noModelText };
  const current = record.modelId ? currentModels.get(record.modelId) : undefined;
  return current ? modelLabelOf(current, record.modelName) : { label: record.modelName };
}

export function modelSearchText(model: NamedModel, identity: string = model.name): string {
  return model.displayName ? `${model.displayName}\n${identity}` : identity;
}

export function displayNameValue(text: string): string | null {
  return text.trim() || null;
}

export function displayNameProblem(text: string): string | null {
  return text.trim().length > DISPLAY_NAME_MAX_LENGTH
    ? `A Display Name is at most ${DISPLAY_NAME_MAX_LENGTH} characters.`
    : null;
}
