import { Command } from '@nestjs/cqrs';
import type { CreatedApiKey } from '@/api-keys/models/api-key';

export class RotateApiKeyCommand extends Command<CreatedApiKey> {
  constructor(
    readonly id: string,
    readonly rotatedById: string,
  ) {
    super();
  }
}
