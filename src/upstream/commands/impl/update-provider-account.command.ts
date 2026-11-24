import { Command } from "@nestjs/cqrs";
import type { ProviderAccount } from "@/upstream/models/provider-account.js";
import type { ProviderAccountChanges } from "@/upstream/schemas/upstream.schema.js";

export class UpdateProviderAccountCommand extends Command<ProviderAccount> {
  constructor(
    readonly providerAccountId: string,
    readonly changes: ProviderAccountChanges,
  ) {
    super();
  }
}
