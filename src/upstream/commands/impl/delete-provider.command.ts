import { Command } from "@nestjs/cqrs";

export class DeleteProviderCommand extends Command<void> {
  constructor(readonly providerId: string) {
    super();
  }
}
