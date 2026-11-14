import { Command } from "@nestjs/cqrs";

/** Deletes an Upstream Model, unless a Route uses it. */
export class DeleteUpstreamModelCommand extends Command<void> {
  constructor(readonly upstreamModelId: string) {
    super();
  }
}
