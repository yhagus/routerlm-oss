import { Command } from "@nestjs/cqrs";

export class DeleteProviderAccountCommand extends Command<void> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
