import { Command } from '@nestjs/cqrs';

export class DeleteUserCommand extends Command<void> {
  constructor(readonly userId: string) {
    super();
  }
}
