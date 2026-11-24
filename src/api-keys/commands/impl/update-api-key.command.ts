import { Command } from "@nestjs/cqrs";
import type { ApiKeySummary } from "@/api-keys/models/api-key.js";
import type { ApiKeyChanges } from "@/api-keys/schemas/api-key.schema.js";

export class UpdateApiKeyCommand extends Command<ApiKeySummary> {
  constructor(
    readonly id: string,
    readonly changes: ApiKeyChanges,
  ) {
    super();
  }
}
