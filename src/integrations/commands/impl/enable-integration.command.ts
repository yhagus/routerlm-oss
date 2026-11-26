import { Command } from '@nestjs/cqrs';

export class EnableIntegrationCommand extends Command<void> {
  constructor(readonly id: string) {
    super();
  }
}
