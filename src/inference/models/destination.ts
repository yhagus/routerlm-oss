import { mayUseModel } from "@/api-keys/models/api-key.js";
import type { ModelKind } from "@/db/schemas/index.js";
import type { Snapshot, SnapshotModel, SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import { GatewayError } from "./gateway-error.js";
import type { InferenceCaller } from "./inference.js";
import type { AttemptPath } from "./route-selection.js";

/** What a request resolved to (spec step 3), with the paths its Attempts may take. */
export interface Destination {
  /** Null for a direct Upstream Model test: no Parameter Policy, no automatic cache breakpoints. */
  model: SnapshotModel | null;
  /** The Model's id, or the Upstream Model's row id for a direct test. */
  id: string;
  /** What the response names as its model. */
  name: string;
  /** Capable of serving the request, in the order they are tried. */
  paths: AttemptPath[];
}

/**
 * The enabled Model named `name`, if the caller may use it (spec step 3).
 * Its Kind is checked apart, once the Usage Log knows the Model.
 */
export function usableModel(
  snapshot: Snapshot,
  name: string,
  caller: InferenceCaller,
): SnapshotModel {
  const model = snapshot.modelsByName.get(name);
  if (!model?.isEnabled) {
    throw new GatewayError("model_not_found", `The Model "${name}" does not exist`, "client");
  }
  if (caller.kind === "api-key" && !mayUseModel(caller.principal, model.id)) {
    throw new GatewayError(
      "model_not_allowed",
      `This API Key may not use the Model "${name}"`,
      "client",
    );
  }
  return model;
}

/**
 * The Upstream Model a direct Upstream Model test names by row id, if it
 * and its Provider are enabled and it has the Kind the client endpoint serves.
 */
export function upstreamModelServedHere(
  snapshot: Snapshot,
  upstreamModelRowId: string,
  endpointKind: ModelKind,
): SnapshotUpstreamModel {
  const upstreamModel = snapshot.upstreamModelsById.get(upstreamModelRowId);
  if (!upstreamModel?.isEnabled || !upstreamModel.provider.isUsable) {
    throw new GatewayError(
      "model_not_found",
      `The Upstream Model "${upstreamModelRowId}" does not exist`,
      "client",
    );
  }
  assertKindServedHere(
    `Upstream Model "${upstreamModel.upstreamModelId}"`,
    upstreamModel.kind,
    endpointKind,
  );
  return upstreamModel;
}

/**
 * Refuses a Model or Upstream Model of another Kind than the client endpoint
 * serves (GLOSSARY "Model Kind"), naming both Kinds.
 */
export function assertKindServedHere(
  named: string,
  itsKind: ModelKind,
  endpointKind: ModelKind,
): void {
  if (itsKind !== endpointKind) {
    throw new GatewayError(
      "invalid_request",
      `The ${named} has the Kind ${itsKind}, but this endpoint serves the Kind ${endpointKind}`,
      "client",
    );
  }
}
