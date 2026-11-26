import type { Capability, ModelKind } from '@/db/schemas';

export interface ClientModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: 'routerlm';
  kind: ModelKind;
  capabilities: Capability[];
}

export interface ClientModelList {
  object: 'list';
  data: ClientModel[];
}
