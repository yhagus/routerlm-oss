import { Command } from "@nestjs/cqrs";

/**
 * Asks the auth host once whether a pending sign-in was approved. On approval
 * it creates the Provider Account holding the OAuth Login; while the sign-in
 * stays pending it schedules the next poll. A sign-in that ended or was
 * forgotten is left alone.
 */
export class PollOauthSignInCommand extends Command<void> {
  constructor(readonly signInId: string) {
    super();
  }
}
