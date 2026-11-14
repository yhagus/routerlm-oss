import { type AnyPgColumn, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id } from "./columns.js";

// People and access: Users, their dashboard sessions, and API Keys.

export const users = pgTable("users", {
  id: id(),
  // Unique as stored: callers lowercase and trim the address before writing it.
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Null for the User created by the setup screen, or when the creator was deleted.
  createdById: uuid("created_by_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});

// The columns @nestjs/authentication's SessionRecord needs, as its Drizzle
// SessionStore example defines them. `id` is the SHA-256 of the session cookie.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: at("created_at").notNull(),
    expiresAt: at("expires_at").notNull(),
    lastActiveAt: at("last_active_at").notNull(),
    mfa: text("mfa", { enum: ["pending", "verified"] }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const apiKeys = pgTable("api_keys", {
  id: id(),
  name: text("name").notNull(),
  // The public id from ApiKeyProvider.generate(), the part findKey() looks up.
  keyId: text("key_id").notNull().unique(),
  // SHA-256 of the whole key. The key itself is shown once and never stored.
  hash: text("hash").notNull(),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  // Null means the key never expires.
  expiresAt: at("expires_at"),
  revokedAt: at("revoked_at"),
  // Empty means every Model. Kept as an array rather than a join table so that
  // deleting a Model never widens a restricted key to "all Models".
  allowedModelIds: uuid("allowed_model_ids").array("[]").notNull().default([]),
});
