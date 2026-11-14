import { AuthenticationStorage, type SessionRecord } from "@nestjs/authentication";
import { authenticationStoreContract } from "@nestjs/authentication/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { DrizzleSessionStore } from "../src/auth/providers/drizzle-session.store.js";
import { type Database, relations } from "../src/db/schemas/relations.js";
import { users } from "../src/db/schemas/index.js";

// The contract's user ids are `user-<uuid>`, while `sessions.user_id` is a
// uuid referencing `users`. This store strips the prefix on the way in, adds
// it back on the way out, and creates each User before its first session.
const CONTRACT_USER_PREFIX = "user-";

class StoreForContractUsers extends DrizzleSessionStore {
  constructor(private readonly database: Database) {
    super(database, new AuthenticationStorage());
  }

  override async createSession(record: SessionRecord): Promise<void> {
    const userId = toDatabaseUserId(record.userId);
    await this.database
      .insert(users)
      .values({ id: userId, email: `${userId}@contract.test`, passwordHash: "-" })
      .onConflictDoNothing();
    await super.createSession({ ...record, userId });
  }

  override async getSession(id: string): Promise<SessionRecord | undefined> {
    const session = await super.getSession(id);
    return session && toContractSession(session);
  }

  override async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const userSessions = await super.listUserSessions(toDatabaseUserId(userId));
    return userSessions.map(toContractSession);
  }

  override async deleteUserSessions(userId: string): Promise<void> {
    await super.deleteUserSessions(toDatabaseUserId(userId));
  }
}

function toDatabaseUserId(contractUserId: string): string {
  return contractUserId.slice(CONTRACT_USER_PREFIX.length);
}

function toContractSession(session: SessionRecord): SessionRecord {
  return { ...session, userId: `${CONTRACT_USER_PREFIX}${session.userId}`, extra: undefined };
}

describe("DrizzleSessionStore", () => {
  const db = drizzle({ connection: process.env.DATABASE_URL ?? "", relations });
  const store = new StoreForContractUsers(db);

  afterAll(async () => {
    await db.$client.end();
  });

  const cases = authenticationStoreContract(() => ({ sessions: store }), {
    contracts: ["sessions"],
    concurrent: true,
  });

  it.each(cases.map((contractCase) => [contractCase.name, contractCase] as const))(
    "%s",
    async (_name, contractCase) => {
      await contractCase.run();
    },
  );
});
