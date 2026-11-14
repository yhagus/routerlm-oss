import { Command } from "@nestjs/cqrs";

/** Deletes a User and, through the foreign key, their sessions. The last User can't be deleted. */
export class DeleteUserCommand extends Command<void> {
  constructor(readonly userId: string) {
    super();
  }
}
