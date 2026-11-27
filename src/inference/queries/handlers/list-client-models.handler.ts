import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { type ApiKeyPrincipal, mayUseModel, mayUseUpstreamModels } from '@/api-keys/models/api-key';
import { CAPABILITIES, type Capability } from '@/db/schemas';
import {
  isRouteUsable,
  isUpstreamModelReachableDirectly,
  type Snapshot,
  type SnapshotModel,
  type SnapshotUpstreamModel,
} from '@/snapshot/models/snapshot';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import {
  type ClientModel,
  type ClientModelList,
  UNGROUPED_OWNER,
} from '@/inference/models/client-model';
import { DIRECT_UPSTREAM_PREFIX, GROUP_SEPARATOR } from '@/inference/models/destination';
import { ListClientModelsQuery } from '@/inference/queries/impl/list-client-models.query';

@QueryHandler(ListClientModelsQuery)
export class ListClientModelsHandler implements IQueryHandler<ListClientModelsQuery> {
  constructor(private readonly snapshot: SnapshotService) {}

  execute({ principal }: ListClientModelsQuery): Promise<ClientModelList> {
    const snapshot = this.snapshot.current;
    const models = [...snapshot.modelsByName.values()]
      .filter((model) => model.isEnabled && mayUseModel(principal, model))
      .flatMap(clientModelsOf)
      .sort(byId);
    const upstreamModels = directUpstreamModelsOf(snapshot, principal).sort(byId);
    return Promise.resolve({ object: 'list', data: [...models, ...upstreamModels] });
  }
}

const MILLISECONDS_PER_SECOND = 1000;

const unixSecondsOf = (date: Date): number => Math.floor(date.getTime() / MILLISECONDS_PER_SECOND);

const byId = (a: ClientModel, b: ClientModel): number => a.id.localeCompare(b.id);

function directUpstreamModelsOf(snapshot: Snapshot, principal: ApiKeyPrincipal): ClientModel[] {
  if (!mayUseUpstreamModels(principal)) {
    return [];
  }
  return [...snapshot.upstreamModelsById.values()]
    .filter(isUpstreamModelReachableDirectly)
    .map(directUpstreamClientModelOf);
}

function directUpstreamClientModelOf(upstreamModel: SnapshotUpstreamModel): ClientModel {
  const providerSlug = upstreamModel.provider.slug;
  return {
    id: `${DIRECT_UPSTREAM_PREFIX}${providerSlug}${GROUP_SEPARATOR}${upstreamModel.upstreamModelId}`,
    object: 'model',
    created: unixSecondsOf(upstreamModel.createdAt),
    owned_by: providerSlug,
    kind: upstreamModel.kind,
    capabilities: CAPABILITIES.filter((capability) =>
      upstreamModel.capabilities.includes(capability),
    ),
  };
}

function clientModelsOf(model: SnapshotModel): ClientModel[] {
  const listing = {
    object: 'model',
    created: unixSecondsOf(model.createdAt),
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
