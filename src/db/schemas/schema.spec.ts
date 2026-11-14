import { getTableColumns } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { attempts, usageLogs } from "./index.js";

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
    .map((column) => column.name);
}

describe("records schema (ADR 0004)", () => {
  it("gives usage_logs no column that could hold prompt or response content", () => {
    expect(columnsThatCouldHoldContent(getTableColumns(usageLogs))).toEqual([]);
  });

  it("gives attempts no column that could hold prompt or response content", () => {
    expect(columnsThatCouldHoldContent(getTableColumns(attempts))).toEqual([]);
  });
});
