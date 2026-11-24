import { Command } from "@nestjs/cqrs";

export class RevokeApiKeyCommand extends Command<void> {
  constructor(readonly id: string) {
    super();
  }
}
