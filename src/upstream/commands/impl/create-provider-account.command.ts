import { Command } from "@nestjs/cqrs";
import type { ProviderAccount } from "@/upstream/models/provider-account.js";
import type { NewProviderAccount } from "@/upstream/schemas/upstream.schema.js";

export class CreateProviderAccountCommand extends Command<ProviderAccount> {
  constructor(readonly newAccount: NewProviderAccount) {
    super();
  }
}
