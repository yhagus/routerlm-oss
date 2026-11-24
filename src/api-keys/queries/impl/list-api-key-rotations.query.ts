import { Query } from "@nestjs/cqrs";
import type { ApiKeyRotation } from "@/api-keys/models/api-key.js";

export class ListApiKeyRotationsQuery extends Query<ApiKeyRotation[]> {
  constructor(readonly apiKeyId: string) {
    super();
  }
}
