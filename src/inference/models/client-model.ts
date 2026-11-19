import type { Capability, ModelKind } from "@/db/schemas/index.js";

/** A Model as `GET /v1/models` shows it: our name only, nothing about Routes or Providers. */
export interface ClientModel {
  id: string;
  object: "model";
  /** Unix seconds. */
  created: number;
  owned_by: "routerlm";
  /** Which client endpoints serve it. */
  kind: ModelKind;
  /** What at least one of its enabled Routes can do. */
  capabilities: Capability[];
}

export interface ClientModelList {
  object: "list";
  data: ClientModel[];
}
