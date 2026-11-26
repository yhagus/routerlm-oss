import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { mayUseModel } from '@/api-keys/models/api-key';
import { CAPABILITIES, type Capability } from '@/db/schemas';
import { isRouteUsable, type SnapshotModel } from '@/snapshot/models/snapshot';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import {
  type ClientModel,
  type ClientModelList,
  UNGROUPED_OWNER,
} from '@/inference/models/client-model';
import { GROUP_SEPARATOR } from '@/inference/models/destination';
import { ListClientModelsQuery } from '@/inference/queries/impl/list-client-models.query';

@QueryHandler(ListClientModelsQuery)
export class ListClientModelsHandler implements IQueryHandler<ListClientModelsQuery> {
  constructor(private readonly snapshot: SnapshotService) {}

  execute({ principal }: ListClientModelsQuery): Promise<ClientModelList> {
    const data = [...this.snapshot.current.modelsByName.values()]
      .filter((model) => model.isEnabled && mayUseModel(principal, model.id))
      .flatMap(clientModelsOf)
      .sort((a, b) => a.id.localeCompare(b.id));
    return Promise.resolve({ object: 'list', data });
  }
}

function clientModelsOf(model: SnapshotModel): ClientModel[] {
  const listing = {
    object: 'model',
    created: Math.floor(model.createdAt.getTime() / 1000),
    kind: model.kind,
    capabilities: combinedCapabilities(model),
  } as const;
  if (model.groupSlugs.length === 0) {
    return [{ ...listing, id: model.name, owned_by: UNGROUPED_OWNER }];
  }
  return model.groupSlugs.map((slug) => ({
    ...listing,
    id: `${slug}${GROUP_SEPARATOR}${model.name}`,
    owned_by: slug,
  }));
}

function combinedCapabilities(model: SnapshotModel): Capability[] {
  const offered = new Set<Capability>();
  for (const route of model.routes.filter(isRouteUsable)) {
    route.upstreamModel.capabilities.forEach((capability) => offered.add(capability));
  }
  return CAPABILITIES.filter((capability) => offered.has(capability));
}
