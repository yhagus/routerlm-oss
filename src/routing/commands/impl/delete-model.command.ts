import { Command } from "@nestjs/cqrs";

export class DeleteModelCommand extends Command<void> {
  constructor(readonly modelId: string) {
    super();
  }
}
