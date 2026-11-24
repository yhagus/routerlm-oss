import { h } from "vue";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createFilteredRowModel,
  createPaginatedRowModel,
  globalFilteringFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from "@tanstack/vue-table";

export const DATA_TABLE_PAGE_SIZE = 50;

export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  columnVisibilityFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  expandedRowModel: createExpandedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

export type DataTableColumn<Row extends RowData> = ColumnDef<typeof dataTableFeatures, Row>;

export function actionsColumn<Row extends RowData>(): DataTableColumn<Row> {
  return {
    id: "actions",
    header: () => h("span", { class: "sr-only" }, "Actions"),
    enableHiding: false,
  };
}

export interface HideableColumn {
  id: string;
  label: string;
  isVisible: boolean;
}
