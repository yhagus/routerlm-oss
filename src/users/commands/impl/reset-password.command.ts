import { Command } from "@nestjs/cqrs";

/** Sets a new password and signs the User out everywhere except `keepSessionId`. */
export class ResetPasswordCommand extends Command<void> {
  constructor(
    readonly userId: string,
    readonly password: string,
    readonly keepSessionId: string,
  ) {
    super();
  }
}
