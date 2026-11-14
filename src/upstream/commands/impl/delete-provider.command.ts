import { Command } from "@nestjs/cqrs";

/** Deletes a Provider with its Provider Accounts and Upstream Models, unless a Route uses one of them. */
export class DeleteProviderCommand extends Command<void> {
  constructor(readonly providerId: string) {
    super();
  }
}
