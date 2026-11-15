import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  filterFn_includesString,
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
 * `manualFiltering` and `manualPagination`.
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
});

/**
 * One DataTable column. `header` is a string for columns the Columns menu
 * lists; set `enableHiding: false` on identity and row-action columns. In
 * client mode, the search matches the values of columns with an accessor.
 */
export type DataTableColumn<Row extends RowData> = ColumnDef<typeof dataTableFeatures, Row>;

/** A column as the Columns menu shows it. */
export interface HideableColumn {
  id: string;
  label: string;
  isVisible: boolean;
}
