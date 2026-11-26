import { Command } from '@nestjs/cqrs';

export class DeleteModelGroupCommand extends Command<void> {
  constructor(readonly modelGroupId: string) {
    super();
  }
}
