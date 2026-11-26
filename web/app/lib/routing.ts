import type { ModelGroupRef } from '~/lib/modelGroups';
import type { ParameterPolicy } from '~/lib/parameterPolicy';
import type { Capability, ModelKind } from '~/lib/upstream';

export interface ModelSummary {
  id: string;
  name: string;
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
  kind: ModelKind;
  isEnabled: boolean;
  parameterPolicy: ParameterPolicy;
  hasAutomaticCacheBreakpoints: boolean;
  createdAt: string;
  updatedAt: string;
  groups: ModelGroupRef[];
  routes: RouteSummary[];
}
