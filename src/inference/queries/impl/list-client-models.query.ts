import { Query } from "@nestjs/cqrs";
import type { ApiKeyPrincipal } from "@/api-keys/models/api-key.js";
import type { ClientModelList } from "@/inference/models/client-model.js";

export class ListClientModelsQuery extends Query<ClientModelList> {
  constructor(readonly principal: ApiKeyPrincipal) {
    super();
  }
}
