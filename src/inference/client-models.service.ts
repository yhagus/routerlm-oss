import { Injectable } from "@nestjs/common";
import { type ApiKeyPrincipal, mayUseModel } from "../api-keys/api-key.js";
import { CAPABILITIES, type Capability } from "../db/schema.js";
import type { SnapshotModel } from "../snapshot/snapshot.js";
import { SnapshotService } from "../snapshot/snapshot.service.js";

/** A Model as `GET /v1/models` shows it: our name only, nothing about Routes or Providers. */
export interface ClientModel {
  id: string;
  object: "model";
  /** Unix seconds. */
  created: number;
  owned_by: "routerlm";
  /** What at least one of its enabled Routes can do. */
  capabilities: Capability[];
}

export interface ClientModelList {
  object: "list";
  data: ClientModel[];
}

/** The Models an API Key may call, in OpenAI's model-list shape. */
@Injectable()
export class ClientModelsService {
  constructor(private readonly snapshot: SnapshotService) {}

  listModels(principal: ApiKeyPrincipal): ClientModelList {
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
    return { object: "list", data };
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
