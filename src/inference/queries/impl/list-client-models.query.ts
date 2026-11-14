import { Query } from "@nestjs/cqrs";
import type { ApiKeyPrincipal } from "../../../api-keys/models/api-key.js";
import type { ClientModelList } from "../../models/client-model.js";

/** The Models an API Key may call, in OpenAI's model-list shape. */
export class ListClientModelsQuery extends Query<ClientModelList> {
  constructor(readonly principal: ApiKeyPrincipal) {
    super();
  }
}
