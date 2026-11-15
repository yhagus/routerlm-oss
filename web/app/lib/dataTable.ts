import { h } from "vue";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from "@tanstack/vue-table";

/** Rows per page in every DataTable; the paginator has no size picker. */
export const DATA_TABLE_PAGE_SIZE = 50;

/**
 * The TanStack features every DataTable registers. The filtered and paginated
 * row models only run in client mode; server mode turns them off with
 * `manualFiltering` and `manualPagination`. The search is the only filter; its
 * `includesString` match comes with global filtering, so no filter functions
 * are registered. Global filtering requires column filtering to be present.
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

/**
 * One DataTable column. `header` is a string for columns the Columns menu
 * lists; set `enableHiding: false` on identity and row-action columns. In
 * client mode, the search matches the values of columns with an accessor.
 */
export type DataTableColumn<Row extends RowData> = ColumnDef<typeof dataTableFeatures, Row>;

/**
 * The row-actions column: a header read only by screen readers, and always
 * shown. Its cells come from the caller's `#cell-actions` slot.
 */
export function actionsColumn<Row extends RowData>(): DataTableColumn<Row> {
  return {
    id: "actions",
    header: () => h("span", { class: "sr-only" }, "Actions"),
    enableHiding: false,
  };
}

/** A column as the Columns menu shows it. */
export interface HideableColumn {
  id: string;
  label: string;
  isVisible: boolean;
}
