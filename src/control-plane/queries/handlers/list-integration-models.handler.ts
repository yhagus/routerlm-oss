import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { CAPABILITIES, type Capability } from '@/db/schemas';
import {
  isRouteUsable,
  type SnapshotModel,
  type SnapshotRoute,
  type SnapshotUpstreamModel,
  standardPricesOf,
} from '@/snapshot/models/snapshot';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { resolvedWindowPrices } from '@/pricing-windows/models/resolved-window-prices';
import { validityInstantsOf } from '@/pricing-windows/models/validity-period';
import type {
  IntegrationModel,
  IntegrationPricingWindow,
  ModelPrices,
} from '@/control-plane/models/integration-model';
import { ListIntegrationModelsQuery } from '@/control-plane/queries/impl/list-integration-models.query';

@QueryHandler(ListIntegrationModelsQuery)
export class ListIntegrationModelsHandler implements IQueryHandler<ListIntegrationModelsQuery> {
  constructor(private readonly snapshot: SnapshotService) {}

  execute({ integration }: ListIntegrationModelsQuery): Promise<IntegrationModel[]> {
    const now = new Date();
    const isWithinCeiling = (model: SnapshotModel): boolean =>
      integration.allowedModelIds.length === 0 || integration.allowedModelIds.includes(model.id);
    const listed = [...this.snapshot.current.modelsByName.values()]
      .filter((model) => model.isEnabled && isWithinCeiling(model))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((model) => integrationModelOf(model, now));
    return Promise.resolve(listed);
  }
}

function integrationModelOf(model: SnapshotModel, now: Date): IntegrationModel {
  const servingRoutes = model.routes.filter(isRouteUsable);
  const firstUpstreamModel = servingRoutes.at(0)?.upstreamModel;
  return {
    id: model.id,
    name: model.name,
    kind: model.kind,
    capabilities: combinedCapabilities(servingRoutes),
    prices: firstUpstreamModel === undefined ? null : pricesOf(firstUpstreamModel),
    pricingWindows:
      firstUpstreamModel === undefined ? [] : pricingWindowsOf(firstUpstreamModel, now),
  };
}

function combinedCapabilities(servingRoutes: SnapshotRoute[]): Capability[] {
  const offered = new Set(servingRoutes.flatMap((route) => route.upstreamModel.capabilities));
  return CAPABILITIES.filter((capability) => offered.has(capability));
}

function pricesOf(upstreamModel: SnapshotUpstreamModel): ModelPrices {
  return { ...standardPricesOf(upstreamModel), unitPrices: upstreamModel.unitPrices };
}

function pricingWindowsOf(
  upstreamModel: SnapshotUpstreamModel,
  now: Date,
): IntegrationPricingWindow[] {
  const standard = standardPricesOf(upstreamModel);
  return upstreamModel.pricingWindows.flatMap((window) => {
    const { start, end } = validityInstantsOf(window, window.timeZone);
    const hasEnded = end !== null && end <= now;
    if (hasEnded) {
      return [];
    }
    return [
      {
        timeZone: window.timeZone,
        ranges: window.ranges,
        validFrom: start,
        validUntil: end,
        prices: resolvedWindowPrices(standard, window.windowPrices),
      },
    ];
  });
}
