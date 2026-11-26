import { Command } from "@nestjs/cqrs";
import type { ProviderAccount } from "@/upstream/models/provider-account";
import type { NewProviderAccount } from "@/upstream/schemas/upstream.schema";

export class CreateProviderAccountCommand extends Command<ProviderAccount> {
  constructor(readonly newAccount: NewProviderAccount) {
    super();
  }
}
