import { Command } from '@nestjs/cqrs';

export class DeleteIntegrationCommand extends Command<void> {
  constructor(readonly id: string) {
    super();
  }
}
