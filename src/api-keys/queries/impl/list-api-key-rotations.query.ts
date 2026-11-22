import { Query } from "@nestjs/cqrs";
import type { ApiKeyRotation } from "@/api-keys/models/api-key.js";

/** An API Key's rotations, newest first. Revoked keys keep their history. */
export class ListApiKeyRotationsQuery extends Query<ApiKeyRotation[]> {
  constructor(readonly apiKeyId: string) {
    super();
  }
}
