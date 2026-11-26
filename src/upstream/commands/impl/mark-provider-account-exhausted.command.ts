import { Command } from '@nestjs/cqrs';

export class MarkProviderAccountExhaustedCommand extends Command<void> {
  constructor(
    readonly providerAccountId: string,
    readonly until: Date | null,
  ) {
    super();
  }
}
