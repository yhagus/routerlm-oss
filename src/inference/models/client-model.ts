import type { Capability, ModelKind } from '@/db/schemas';

export const UNGROUPED_OWNER = 'routerlm';

export interface ClientModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  kind: ModelKind;
  capabilities: Capability[];
}

export interface ClientModelList {
  object: 'list';
  data: ClientModel[];
}
