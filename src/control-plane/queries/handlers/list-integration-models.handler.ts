import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { CAPABILITIES, type Capability } from "@/db/schemas/index.js";
import {
  isRouteUsable,
  type SnapshotModel,
  type SnapshotRoute,
  type SnapshotUpstreamModel,
} from "@/snapshot/models/snapshot.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { IntegrationModel, ModelPrices } from "../../models/integration-model.js";
import { ListIntegrationModelsQuery } from "../impl/list-integration-models.query.js";

@QueryHandler(ListIntegrationModelsQuery)
export class ListIntegrationModelsHandler implements IQueryHandler<ListIntegrationModelsQuery> {
  constructor(private readonly snapshot: SnapshotService) {}

  execute({ integration }: ListIntegrationModelsQuery): Promise<IntegrationModel[]> {
    const isWithinCeiling = (model: SnapshotModel): boolean =>
      integration.allowedModelIds.length === 0 || integration.allowedModelIds.includes(model.id);
    const listed = [...this.snapshot.current.modelsByName.values()]
      .filter((model) => model.isEnabled && isWithinCeiling(model))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(integrationModelOf);
    return Promise.resolve(listed);
  }
}

function integrationModelOf(model: SnapshotModel): IntegrationModel {
  // Routes come in the order the gateway tries them.
  const servingRoutes = model.routes.filter(isRouteUsable);
  const firstUpstreamModel = servingRoutes.at(0)?.upstreamModel;
  return {
    id: model.id,
    name: model.name,
    kind: model.kind,
    capabilities: combinedCapabilities(servingRoutes),
    prices: firstUpstreamModel === undefined ? null : pricesOf(firstUpstreamModel),
  };
}

function combinedCapabilities(servingRoutes: SnapshotRoute[]): Capability[] {
  const offered = new Set(servingRoutes.flatMap((route) => route.upstreamModel.capabilities));
  // In the Catalog's order, not the order Routes happen to list them.
  return CAPABILITIES.filter((capability) => offered.has(capability));
}

function pricesOf(upstreamModel: SnapshotUpstreamModel): ModelPrices {
  return {
    inputPrice: upstreamModel.inputPrice,
    outputPrice: upstreamModel.outputPrice,
    cacheReadPrice: upstreamModel.cacheReadPrice,
    cacheWritePrice: upstreamModel.cacheWritePrice,
    unitPrices: upstreamModel.unitPrices,
  };
}
