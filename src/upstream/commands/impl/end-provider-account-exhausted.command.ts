import { Command } from '@nestjs/cqrs';

export class EndProviderAccountExhaustedCommand extends Command<void> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
