import { getTableColumns } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { attempts, usageLogs } from "@/db/schemas/index.js";

/**
 * The names a Usage Log and its Attempts copy at request time (ADR 0024).
 * Each is operator-entered configuration (the name of a Model, an Upstream
 * Model, a Provider's slug and name, a Provider Account's name, an API Key's name),
 * never prompt or response content, so ADR 0004 still holds. The unit tier
 * is a size or resolution key of the Upstream Model's configured prices.
 */
const SNAPSHOT_NAME_COLUMNS = [
  "model_name",
  "upstream_model_name",
  "provider_slug",
  "provider_name",
  "provider_account_name",
  "api_key_name",
  "unit_tier",
];

// A column can hold prompt or response content if it takes free text or JSON.
// Text columns restricted to an enum of codes are measurements, not content.
function columnsThatCouldHoldContent(columns: Record<string, PgColumn>): string[] {
  return Object.values(columns)
    .filter((column) => {
      const sqlType = column.getSQLType();
      const isFreeText = sqlType === "text" && !column.enumValues;
      const isJson = sqlType === "json" || sqlType === "jsonb";
      return isFreeText || isJson;
    })
    .map((column) => column.name)
    .filter((name) => !SNAPSHOT_NAME_COLUMNS.includes(name));
}

describe("records schema (ADR 0004)", () => {
  it("gives usage_logs no column that could hold prompt or response content", () => {
    expect(columnsThatCouldHoldContent(getTableColumns(usageLogs))).toEqual([]);
  });

  it("gives attempts no column that could hold prompt or response content", () => {
    expect(columnsThatCouldHoldContent(getTableColumns(attempts))).toEqual([]);
  });
});
