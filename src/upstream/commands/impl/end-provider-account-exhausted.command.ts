import { Command } from "@nestjs/cqrs";

/** Makes an Exhausted Provider Account routable again; a Cooldown from a failure stays. */
export class EndProviderAccountExhaustedCommand extends Command<void> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
