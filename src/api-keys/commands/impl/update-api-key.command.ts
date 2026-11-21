import { Command } from "@nestjs/cqrs";
import type { ApiKeySummary } from "../../models/api-key.js";
import type { ApiKeyChanges } from "../../schemas/api-key.schema.js";

/** Changes a key's name, expiry, allowed Models, Spend Limit or Request Rate. A revoked key can't be changed. */
export class UpdateApiKeyCommand extends Command<ApiKeySummary> {
  constructor(
    readonly id: string,
    readonly changes: ApiKeyChanges,
  ) {
    super();
  }
}
