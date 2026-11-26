import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { mayUseModel } from '@/api-keys/models/api-key';
import { CAPABILITIES, type Capability } from '@/db/schemas';
import { isRouteUsable, type SnapshotModel } from '@/snapshot/models/snapshot';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { ClientModel, ClientModelList } from '@/inference/models/client-model';
import { ListClientModelsQuery } from '@/inference/queries/impl/list-client-models.query';

@QueryHandler(ListClientModelsQuery)
export class ListClientModelsHandler implements IQueryHandler<ListClientModelsQuery> {
  constructor(private readonly snapshot: SnapshotService) {}

  execute({ principal }: ListClientModelsQuery): Promise<ClientModelList> {
    const data = [...this.snapshot.current.modelsByName.values()]
      .filter((model) => model.isEnabled && mayUseModel(principal, model.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((model): ClientModel => ({
        id: model.name,
        object: 'model',
        created: Math.floor(model.createdAt.getTime() / 1000),
        owned_by: 'routerlm',
        kind: model.kind,
        capabilities: combinedCapabilities(model),
      }));
    return Promise.resolve({ object: 'list', data });
  }
}

function combinedCapabilities(model: SnapshotModel): Capability[] {
  const offered = new Set<Capability>();
  for (const route of model.routes.filter(isRouteUsable)) {
    route.upstreamModel.capabilities.forEach((capability) => offered.add(capability));
  }
  return CAPABILITIES.filter((capability) => offered.has(capability));
}
