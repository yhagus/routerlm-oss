import { getTableColumns } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { attempts, usageLogs } from '@/db/schemas';

const SNAPSHOT_NAME_COLUMNS = [
  'model_name',
  'upstream_model_name',
  'provider_slug',
  'provider_name',
  'provider_account_name',
  'api_key_name',
  'integration_name',
  'customer_id',
  'unit_tier',
  'pricing_window_name',
];

const REQUEST_METADATA_COLUMNS = [
  'user_agent',
  'client_ip',
  'upstream_request_id',
  'requested_model_name',
];

function columnsThatCouldHoldContent(columns: Record<string, PgColumn>): string[] {
  return Object.values(columns)
    .filter((column) => {
      const sqlType = column.getSQLType();
      const isFreeText = sqlType === 'text' && !column.enumValues;
      const isJson = sqlType === 'json' || sqlType === 'jsonb';
      return isFreeText || isJson;
    })
    .map((column) => column.name)
    .filter((name) => !SNAPSHOT_NAME_COLUMNS.includes(name))
    .filter((name) => !REQUEST_METADATA_COLUMNS.includes(name));
}

describe('records schema (ADR 0004)', () => {
  it('gives usage_logs no column that could hold prompt or response content', () => {
    expect(columnsThatCouldHoldContent(getTableColumns(usageLogs))).toEqual([]);
  });

  it('gives attempts no column that could hold prompt or response content', () => {
    expect(columnsThatCouldHoldContent(getTableColumns(attempts))).toEqual([]);
  });
});
