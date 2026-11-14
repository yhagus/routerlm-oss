import { Command } from "@nestjs/cqrs";

/** Deletes the Model and its Routes. API Keys restricted to it keep its id (see `api_keys`). */
export class DeleteModelCommand extends Command<void> {
  constructor(readonly modelId: string) {
    super();
  }
}
