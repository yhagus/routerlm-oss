import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { mayUseModel } from "@/api-keys/models/api-key.js";
import { CAPABILITIES, type Capability } from "@/db/schemas/index.js";
import type { SnapshotModel } from "@/snapshot/models/snapshot.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { ClientModel, ClientModelList } from "../../models/client-model.js";
import { ListClientModelsQuery } from "../impl/list-client-models.query.js";

@QueryHandler(ListClientModelsQuery)
export class ListClientModelsHandler implements IQueryHandler<ListClientModelsQuery> {
  constructor(private readonly snapshot: SnapshotService) {}

  execute({ principal }: ListClientModelsQuery): Promise<ClientModelList> {
    const data = [...this.snapshot.current.modelsByName.values()]
      .filter((model) => model.isEnabled && mayUseModel(principal, model.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((model): ClientModel => ({
        id: model.name,
        object: "model",
        created: Math.floor(model.createdAt.getTime() / 1000),
        owned_by: "routerlm",
        capabilities: combinedCapabilities(model),
      }));
    return Promise.resolve({ object: "list", data });
  }
}

function combinedCapabilities(model: SnapshotModel): Capability[] {
  const offered = new Set<Capability>();
  for (const { isEnabled, upstreamModel } of model.routes) {
    if (isEnabled && upstreamModel.isEnabled && upstreamModel.provider.isEnabled) {
      upstreamModel.capabilities.forEach((capability) => offered.add(capability));
    }
  }
  // In the Catalog's order, not the order Routes happen to list them.
  return CAPABILITIES.filter((capability) => offered.has(capability));
}
