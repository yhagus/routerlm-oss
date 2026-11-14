import {
  AuthenticationStorage,
  type SessionRecord,
  type SessionStore,
} from "@nestjs/authentication";
import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, lt } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { sessions, users } from "@/db/schemas/index.js";
import { userColumns } from "@/users/models/user.js";

type SessionRow = typeof sessions.$inferSelect;

/**
 * Dashboard sessions in PostgreSQL, as @nestjs/authentication's Drizzle
 * example stores them. Reading a session joins its User, so a session whose
 * User was deleted reads as unknown (and the FK cascade deletes it anyway).
 */
@Injectable()
export class DrizzleSessionStore implements SessionStore {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ sessions: this });
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const [row] = await this.db
      .select({ session: sessions, user: userColumns })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, id));
    if (!row) {
      return undefined;
    }
    return { ...toSessionRecord(row.session), extra: { user: row.user } };
  }

  async createSession(record: SessionRecord): Promise<void> {
    // Times come from SessionService's clock, so the new session's creation is "now".
    await this.db.delete(sessions).where(lt(sessions.expiresAt, record.createdAt));
    await this.db.insert(sessions).values({
      id: record.id,
      userId: record.userId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastActiveAt: record.lastActiveAt,
      mfa: record.mfa,
      metadata: record.metadata,
    });
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ lastActiveAt })
      .where(and(eq(sessions.id, id), lt(sessions.lastActiveAt, lastActiveAt)));
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(sessions)
      .where(eq(sessions.id, id))
      .returning({ id: sessions.id });
    return deleted.length > 0;
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.userId, userId));
    return rows.map(toSessionRecord);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastActiveAt: row.lastActiveAt,
    mfa: row.mfa ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}
