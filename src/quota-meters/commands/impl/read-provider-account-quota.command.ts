import { Command } from '@nestjs/cqrs';
import type { ProviderAccountQuota } from '@/quota-meters/models/quota-meter';

export class ReadProviderAccountQuotaCommand extends Command<ProviderAccountQuota> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
