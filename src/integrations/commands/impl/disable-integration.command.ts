import { Command } from '@nestjs/cqrs';

export class DisableIntegrationCommand extends Command<void> {
  constructor(readonly id: string) {
    super();
  }
}
