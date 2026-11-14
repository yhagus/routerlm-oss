import { Command } from "@nestjs/cqrs";
import type { CreatedApiKey } from "../../models/api-key.js";
import type { NewApiKey } from "../../schemas/new-api-key.schema.js";

/** Creates a key and returns it whole, the only time it is ever shown. Only its hash is stored. */
export class CreateApiKeyCommand extends Command<CreatedApiKey> {
  constructor(
    readonly newKey: NewApiKey,
    readonly createdById: string,
  ) {
    super();
  }
}
