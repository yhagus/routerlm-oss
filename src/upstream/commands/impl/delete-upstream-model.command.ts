import { Command } from "@nestjs/cqrs";

export class DeleteUpstreamModelCommand extends Command<void> {
  constructor(readonly upstreamModelId: string) {
    super();
  }
}
