import { Command } from "@nestjs/cqrs";
import type { ProviderAccount } from "@/upstream/models/provider-account";
import type { ProviderAccountChanges } from "@/upstream/schemas/upstream.schema";

export class UpdateProviderAccountCommand extends Command<ProviderAccount> {
  constructor(
    readonly providerAccountId: string,
    readonly changes: ProviderAccountChanges,
  ) {
    super();
  }
}
