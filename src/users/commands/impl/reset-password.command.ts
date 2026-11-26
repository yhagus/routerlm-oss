import { Command } from '@nestjs/cqrs';

export class ResetPasswordCommand extends Command<void> {
  constructor(
    readonly userId: string,
    readonly password: string,
    readonly keepSessionId: string,
  ) {
    super();
  }
}
