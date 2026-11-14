import { Command } from "@nestjs/cqrs";
import type { ProviderAccount } from "../../models/provider-account.js";
import type { ProviderAccountChanges } from "../../schemas/upstream.schema.js";

/**
 * Edits a Provider Account. A new `key` replaces the stored one. Enabling it
 * clears the reason the gateway gave for disabling it.
 */
export class UpdateProviderAccountCommand extends Command<ProviderAccount> {
  constructor(
    readonly providerAccountId: string,
    readonly changes: ProviderAccountChanges,
  ) {
    super();
  }
}
