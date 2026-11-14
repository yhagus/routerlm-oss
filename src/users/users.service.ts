import { PasswordHasher, SessionService } from "@nestjs/authentication";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc, count, eq, sql } from "drizzle-orm";
import type { Database } from "../db/relations.js";
import { users } from "../db/schema.js";
import { normalizeEmail, type User, userColumns } from "./user.js";
import type { NewUser } from "./users.schemas.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UNIQUE_VIOLATION = "23505";

@Injectable()
export class UsersService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: SessionService,
  ) {}

  async isSetupRequired(): Promise<boolean> {
    const [existing] = await this.db.select({ id: users.id }).from(users).limit(1);
    return existing === undefined;
  }

  /** Creates the first User. Refused once any User exists. */
  async createFirstUser(newUser: NewUser): Promise<User> {
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

  async createUser(newUser: NewUser, createdById: string): Promise<User> {
    const passwordHash = await this.passwordHasher.hash(newUser.password);
    try {
      const [created] = await this.db
        .insert(users)
        .values({ email: normalizeEmail(newUser.email), passwordHash, createdById })
        .returning(userColumns);
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("A User with this email already exists");
      }
      throw error;
    }
  }

  listUsers(): Promise<User[]> {
    return this.db.select(userColumns).from(users).orderBy(asc(users.createdAt));
  }

  /**
   * The User whose password this is, or `null`. Answers in the same time
   * whether or not the email exists, so callers can't tell the two apart.
   */
  async findUserByCredentials(email: string, password: string): Promise<User | null> {
    const [found] = await this.db
      .select({ ...userColumns, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, normalizeEmail(email)));
    const isPasswordCorrect = await this.passwordHasher.verify(password, found?.passwordHash);
    if (!found || !isPasswordCorrect) {
      return null;
    }
    const { passwordHash: _passwordHash, ...user } = found;
    return user;
  }

  /** Sets a new password and signs the User out everywhere except `keepSessionId`. */
  async resetPassword(userId: string, password: string, keepSessionId: string): Promise<void> {
    const passwordHash = await this.passwordHasher.hash(password);
    const updated = await this.db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated.length === 0) {
      throw new NotFoundException("User not found");
    }
    await this.sessions.revokeAll(userId, { except: keepSessionId });
  }

  /** Deletes a User and, through the foreign key, their sessions. The last User can't be deleted. */
  async deleteUser(userId: string): Promise<void> {
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

async function lockUsers(tx: Transaction): Promise<void> {
  // SHARE ROW EXCLUSIVE conflicts with itself and with writes, but not with reads.
  await tx.execute(sql`lock table ${users} in share row exclusive mode`);
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  // Drizzle wraps the driver error in `cause`.
  const driverError = error.cause ?? error;
  return (
    typeof driverError === "object" &&
    driverError !== null &&
    "code" in driverError &&
    driverError.code === UNIQUE_VIOLATION
  );
}
