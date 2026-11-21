import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { at, createdAt, id } from "./columns.js";

// People and access: Users, their dashboard sessions, Integrations and API Keys.

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

// An outside business application that issues API Keys to its own Customers.
export const integrations = pgTable("integrations", {
  id: id(),
  name: text("name").notNull(),
  // The Integration Secret, as API Keys keep theirs: the public id from
  // ApiKeyProvider.generate() that findKey() looks up, and the SHA-256 of the
  // whole secret. The secret itself is shown once and never kept.
  keyId: text("key_id").notNull().unique(),
  hash: text("hash").notNull(),
  // The Models its API Keys may be restricted to. Empty means every Model;
  // an array for the same reason as on API Keys.
  allowedModelIds: uuid("allowed_model_ids").array("[]").notNull().default([]),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  // Null while active. A disabled Integration's secret and API Keys stop working.
  disabledAt: at("disabled_at"),
});

// One row per rotation of an Integration Secret, newest last, shaped like api_key_rotations.
export const integrationRotations = pgTable(
  "integration_rotations",
  {
    id: id(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    rotatedAt: at("rotated_at").notNull().defaultNow(),
    rotatedById: uuid("rotated_by_id").references(() => users.id, { onDelete: "set null" }),
    previousKeyId: text("previous_key_id").notNull(),
    newKeyId: text("new_key_id").notNull(),
  },
  (table) => [
    index("integration_rotations_integration_id_rotated_at_idx").on(
      table.integrationId,
      table.rotatedAt,
    ),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    name: text("name").notNull(),
    // The public id from ApiKeyProvider.generate(), the part findKey() looks up.
    keyId: text("key_id").notNull().unique(),
    // SHA-256 of the whole key, what sign-in compares against.
    hash: text("hash").notNull(),
    // The whole key, encrypted (ProviderKeyCipher, purpose "api-key"), only so
    // the dashboard can show it again. Null for keys created before keys were
    // kept, and for revoked keys.
    encryptedKey: text("encrypted_key"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    // Null means the key never expires.
    expiresAt: at("expires_at"),
    revokedAt: at("revoked_at"),
    // Empty means every Model. Kept as an array rather than a join table so that
    // deleting a Model never widens a restricted key to "all Models".
    allowedModelIds: uuid("allowed_model_ids").array("[]").notNull().default([]),
    // The Integration that issued the key; null for a key a User created. Deleting
    // the Integration revokes its keys first, then clears this.
    integrationId: uuid("integration_id").references(() => integrations.id, {
      onDelete: "set null",
    }),
    // The id the Integration gives its Customer: set on every key an Integration
    // issues, never changed, null on a User's key. Kept after the Integration is deleted.
    customerId: text("customer_id"),
    // USD. Null means no limit.
    spendLimit: numeric("spend_limit", { precision: 18, scale: 10, mode: "number" }),
    // USD of Cost counted against the Spend Limit, added with each Usage Log (ADR 0035).
    spent: numeric("spent", { precision: 18, scale: 10, mode: "number" }).notNull().default(0),
    // Requests per minute. Null means no limit.
    requestRate: integer("request_rate"),
  },
  (table) => [
    index("api_keys_integration_id_customer_id_idx").on(table.integrationId, table.customerId),
  ],
);

// One row per rotation of an API Key, newest last. Rotations before this table
// existed were never recorded.
export const apiKeyRotations = pgTable(
  "api_key_rotations",
  {
    id: id(),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    rotatedAt: at("rotated_at").notNull().defaultNow(),
    rotatedById: uuid("rotated_by_id").references(() => users.id, { onDelete: "set null" }),
    // Public key ids: the one that stopped working and the one that replaced it.
    previousKeyId: text("previous_key_id").notNull(),
    newKeyId: text("new_key_id").notNull(),
  },
  (table) => [
    index("api_key_rotations_api_key_id_rotated_at_idx").on(table.apiKeyId, table.rotatedAt),
  ],
);
