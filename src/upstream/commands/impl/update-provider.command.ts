import { Command } from "@nestjs/cqrs";
import type { Provider } from "../../models/provider.js";
import type { ProviderChanges } from "../../schemas/upstream.schema.js";

/** Edits a Provider, including enabling or disabling it. */
export class UpdateProviderCommand extends Command<Provider> {
  constructor(
    readonly providerId: string,
    readonly changes: ProviderChanges,
  ) {
    super();
  }
}
