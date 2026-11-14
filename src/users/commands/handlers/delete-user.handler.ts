import { ConflictException, NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { count, eq } from "drizzle-orm";
import type { Database } from "../../../db/schemas/relations.js";
import { users } from "../../../db/schemas/index.js";
import { lockUsers } from "../../models/lock-users.js";
import { DeleteUserCommand } from "../impl/delete-user.command.js";

@CommandHandler(DeleteUserCommand)
export class DeleteUserHandler implements ICommandHandler<DeleteUserCommand> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ userId }: DeleteUserCommand): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Two Users deleting each other at once must not leave none.
      await lockUsers(tx);
      const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!target) {
        throw new NotFoundException("User not found");
      }
      const [{ userCount }] = await tx.select({ userCount: count() }).from(users);
      if (userCount === 1) {
        throw new ConflictException("The last User can't be deleted");
      }
      await tx.delete(users).where(eq(users.id, userId));
    });
  }
}
