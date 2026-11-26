import { Command } from '@nestjs/cqrs';

export class PollOauthSignInCommand extends Command<void> {
  constructor(readonly signInId: string) {
    super();
  }
}
