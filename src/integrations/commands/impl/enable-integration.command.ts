import { Command } from "@nestjs/cqrs";

/** Lifts a suspension: the same secret and API Keys work again. */
export class EnableIntegrationCommand extends Command<void> {
  constructor(readonly id: string) {
    super();
  }
}
