import { Command } from "@nestjs/cqrs";
import type { CreatedApiKey } from "@/api-keys/models/api-key.js";
import type { NewApiKey } from "@/api-keys/schemas/api-key.schema.js";

export class CreateApiKeyCommand extends Command<CreatedApiKey> {
  constructor(
    readonly newKey: NewApiKey,
    readonly createdById: string,
  ) {
    super();
  }
}
