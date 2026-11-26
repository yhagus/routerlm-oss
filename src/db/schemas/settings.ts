import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { updatedAt } from './columns';

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});
