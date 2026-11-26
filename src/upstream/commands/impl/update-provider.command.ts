import { Command } from '@nestjs/cqrs';
import type { Provider } from '@/upstream/models/provider';
import type { ProviderChanges } from '@/upstream/schemas/upstream.schema';

export class UpdateProviderCommand extends Command<Provider> {
  constructor(
    readonly providerId: string,
    readonly changes: ProviderChanges,
  ) {
    super();
  }
}
