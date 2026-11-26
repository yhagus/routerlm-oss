import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { at, createdAt, id } from './columns';

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdById: uuid('created_by_id').references((): AnyPgColumn => users.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    lastActiveAt: at('last_active_at').notNull(),
    mfa: text('mfa', { enum: ['pending', 'verified'] }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const integrations = pgTable('integrations', {
  id: id(),
  name: text('name').notNull(),
  keyId: text('key_id').notNull().unique(),
  hash: text('hash').notNull(),
  allowedModelIds: uuid('allowed_model_ids').array('[]').notNull().default([]),
  allowedModelGroupIds: uuid('allowed_model_group_ids').array('[]').notNull().default([]),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  disabledAt: at('disabled_at'),
  lastUsedAt: at('last_used_at'),
});

export const integrationRotations = pgTable(
  'integration_rotations',
  {
    id: id(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    rotatedAt: at('rotated_at').notNull().defaultNow(),
    rotatedById: uuid('rotated_by_id').references(() => users.id, { onDelete: 'set null' }),
    previousKeyId: text('previous_key_id').notNull(),
    newKeyId: text('new_key_id').notNull(),
  },
  (table) => [
    index('integration_rotations_integration_id_rotated_at_idx').on(
      table.integrationId,
      table.rotatedAt,
    ),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    name: text('name').notNull(),
    keyId: text('key_id').notNull().unique(),
    hash: text('hash').notNull(),
    encryptedKey: text('encrypted_key'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: at('expires_at'),
    revokedAt: at('revoked_at'),
    allowedModelIds: uuid('allowed_model_ids').array('[]').notNull().default([]),
    allowedModelGroupIds: uuid('allowed_model_group_ids').array('[]').notNull().default([]),
    integrationId: uuid('integration_id').references(() => integrations.id, {
      onDelete: 'set null',
    }),
    customerId: text('customer_id'),
    spendLimit: numeric('spend_limit', { precision: 18, scale: 10, mode: 'number' }),
    spent: numeric('spent', { precision: 18, scale: 10, mode: 'number' }).notNull().default(0),
    requestRate: integer('request_rate'),
  },
  (table) => [
    index('api_keys_integration_id_customer_id_idx').on(table.integrationId, table.customerId),
  ],
);

export const apiKeyRotations = pgTable(
  'api_key_rotations',
  {
    id: id(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    rotatedAt: at('rotated_at').notNull().defaultNow(),
    rotatedById: uuid('rotated_by_id').references(() => users.id, { onDelete: 'set null' }),
    previousKeyId: text('previous_key_id').notNull(),
    newKeyId: text('new_key_id').notNull(),
  },
  (table) => [
    index('api_key_rotations_api_key_id_rotated_at_idx').on(table.apiKeyId, table.rotatedAt),
  ],
);
