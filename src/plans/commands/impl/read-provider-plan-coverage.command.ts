import { Command } from '@nestjs/cqrs';

export class ReadProviderPlanCoverageCommand extends Command<void> {
  constructor(readonly providerId: string) {
    super();
  }
}
