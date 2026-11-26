import { Command } from '@nestjs/cqrs';
import type { ProviderAccount } from '@/upstream/models/provider-account';

export class ReadProviderAccountPlanCommand extends Command<ProviderAccount> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
