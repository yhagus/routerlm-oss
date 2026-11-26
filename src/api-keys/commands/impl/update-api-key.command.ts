import { Command } from '@nestjs/cqrs';
import type { ApiKeySummary } from '@/api-keys/models/api-key';
import type { ApiKeyChanges } from '@/api-keys/schemas/api-key.schema';

export class UpdateApiKeyCommand extends Command<ApiKeySummary> {
  constructor(
    readonly id: string,
    readonly changes: ApiKeyChanges,
  ) {
    super();
  }
}
