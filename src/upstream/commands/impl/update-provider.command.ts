import { Command } from "@nestjs/cqrs";
import type { Provider } from "@/upstream/models/provider.js";
import type { ProviderChanges } from "@/upstream/schemas/upstream.schema.js";

/** Edits a Provider, including enabling or disabling it. */
export class UpdateProviderCommand extends Command<Provider> {
  constructor(
    readonly providerId: string,
    readonly changes: ProviderChanges,
  ) {
    super();
  }
}
