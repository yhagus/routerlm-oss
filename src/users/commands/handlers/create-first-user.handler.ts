import { PasswordHasher } from "@nestjs/authentication";
import { ConflictException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "../../../db/relations.js";
import { users } from "../../../db/schema.js";
import { lockUsers } from "../../models/lock-users.js";
import { normalizeEmail, type User, userColumns } from "../../models/user.js";
import { CreateFirstUserCommand } from "../impl/create-first-user.command.js";

@CommandHandler(CreateFirstUserCommand)
export class CreateFirstUserHandler implements ICommandHandler<CreateFirstUserCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute({ newUser }: CreateFirstUserCommand): Promise<User> {
    const passwordHash = await this.passwordHasher.hash(newUser.password);
    return this.db.transaction(async (tx) => {
      // Serialises concurrent setups so only one of them sees an empty table.
      await lockUsers(tx);
      const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing) {
        throw new ConflictException("Setup is already complete");
      }
      const [created] = await tx
        .insert(users)
        .values({ email: normalizeEmail(newUser.email), passwordHash })
        .returning(userColumns);
      return created;
    });
  }
}
