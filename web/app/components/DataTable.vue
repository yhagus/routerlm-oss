<script setup lang="ts" generic="Row extends RowData">
/**
 * A list in a table panel: a toolbar (search, the caller's extra controls,
 * Filters, Columns, Refresh, paginator), the active-filter tokens, then the
 * rows, 50 to a page. Search (`?q=`) and page (`?page=`) live in the URL.
 *
 * Client mode (no `rowCount`): pass every row the caller's filters keep. The
 * table searches the values of columns with an accessor, then pages in the
 * browser.
 *
 *   <DataTable table-id="providers" label="Providers" :columns :rows="filteredRows"
 *     :get-row-id="(row) => row.id" :is-loading :error :refresh :filters="filterTokens"
 *     @clear-filters="clearFilters">
 *     <template #filters><AppMultiSelect v-model="protocols" … /></template>
 *     <template #cell-name="{ row }"><strong>{{ row.name }}</strong></template>
 *     <template #empty><EmptyState :icon="Plug"><strong>No Providers yet.</strong></EmptyState></template>
 *   </DataTable>
 *
 * Server mode (`rowCount` set): pass the current page's rows and the total.
 * The caller reads the same URL state, `useQueryParam("q", …)` and
 * `useQueryPage()`, puts it in its request, and gets the page back. Changing
 * the search or a filter returns to page 1.
 *
 *   const search = useQueryParam("q", { default: "", isValid: anyText });
 *   const page = useQueryPage();
 *   const { data, … } = useDashboardApi("/captures", { query: { q: search, page } });
 *   <DataTable … :rows="data?.items ?? []" :row-count="data?.total ?? 0" />
 *
 * Rows stay on screen while `refresh` runs; placeholders show only while
 * `isLoading` (nothing loaded yet).
 */
import { CloudOff, RefreshCw, SearchX } from "@lucide/vue";
import {
  FlexRender,
  functionalUpdate,
  useTable,
  type PaginationState,
  type RowData,
  type Updater,
  type ColumnVisibilityState,
} from "@tanstack/vue-table";
import type { HTMLAttributes } from "vue";
import { type ActiveFilter, searchFilterTokens } from "~/lib/activeFilters";
import {
  DATA_TABLE_PAGE_SIZE,
  dataTableFeatures,
  type DataTableColumn,
  type HideableColumn,
} from "~/lib/dataTable";

const props = withDefaults(
  defineProps<{
    /** Names the stored column choice: `routerlm:columns:<tableId>`. */
    tableId: string;
    /** What the rows are, plural: "Providers". Used in accessible names and the error. */
    label: string;
    columns: DataTableColumn<Row>[];
    /** Client mode: every row the caller's filters keep. Server mode: the current page. */
    rows: Row[];
    getRowId: (row: Row) => string;
    rowClass?: (row: Row) => HTMLAttributes["class"];
    /** Nothing loaded yet: rows show placeholders. */
    isLoading: boolean;
    /** A failed load; shows an error with Retry in place of the rows. */
    error?: unknown;
    /** Re-runs the current query; Refresh and Retry call it. */
    refresh: () => Promise<unknown>;
    /** Server mode: how many rows match in all. Leave it out for client mode. */
    rowCount?: number;
    /** The caller's filters in effect, one token each; the search token is added here. */
    filters?: ActiveFilter[];
    searchPlaceholder?: string;
  }>(),
  { filters: () => [], searchPlaceholder: "Search" },
);
const emit = defineEmits<{ clearFilters: [] }>();
defineSlots<
  {
    /** Extra visible controls after the search, such as a time-range select. */
    controls?: () => unknown;
    /** The filter fields, stacked in the Filters popover. */
    filters?: () => unknown;
    /** Shown when there are no rows and no search or filter is set. */
    empty?: () => unknown;
  } & {
    /** One cell's content; without it the column's `cell` renders. */
    [cell: `cell-${string}`]: (props: { row: Row }) => unknown;
  }
>();

const search = useQueryParam("q", { default: "", isValid: anyText, debounce: 300 });
const page = useQueryPage();
const columnVisibility = useColumnVisibility(props.tableId);

const isServerMode = computed(() => props.rowCount !== undefined);
const searchQuery = computed(() => search.value.trim());
const hasQuery = computed(() => searchQuery.value !== "" || props.filters.length > 0);
const activeFilters = computed(() => [...searchFilterTokens(search), ...props.filters]);

const pagination = computed<PaginationState>(() => ({
  pageIndex: page.value - 1,
  pageSize: DATA_TABLE_PAGE_SIZE,
}));

const table = useTable({
  features: dataTableFeatures,
  columns: computed(() => props.columns),
  data: computed(() => props.rows),
  getRowId: (row: Row) => props.getRowId(row),
  state: computed(() => ({
    pagination: pagination.value,
    columnVisibility: columnVisibility.value,
    globalFilter: isServerMode.value ? undefined : searchQuery.value,
  })),
  manualPagination: isServerMode,
  manualFiltering: isServerMode,
  autoResetPageIndex: false,
  onPaginationChange: (updater: Updater<PaginationState>) => {
    page.value = functionalUpdate(updater, pagination.value).pageIndex + 1;
  },
  onColumnVisibilityChange: (updater: Updater<ColumnVisibilityState>) => {
    columnVisibility.value = functionalUpdate(updater, columnVisibility.value);
  },
});

// Counted here rather than through the table's `rowCount` option: the adapter
// drops an option whose ref holds `undefined`, which client mode would pass.
const rowCount = computed(() => props.rowCount ?? table.getFilteredRowModel().rows.length);
const pageCount = computed(() => Math.max(1, Math.ceil(rowCount.value / DATA_TABLE_PAGE_SIZE)));
const visibleColumnCount = computed(() => table.getVisibleLeafColumns().length);
const hasRows = computed(() => rowCount.value > 0);
const isPaginatorShown = computed(() => !props.isLoading && !props.error && hasRows.value);

const hideableColumns = computed<HideableColumn[]>(() =>
  table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide())
    .map((column) => ({
      id: column.id,
      label: typeof column.columnDef.header === "string" ? column.columnDef.header : column.id,
      isVisible: column.getIsVisible(),
    })),
);

function handleColumnToggle(columnId: string, isVisible: boolean): void {
  table.getColumn(columnId)?.toggleVisibility(isVisible);
}

function handleColumnsReset(): void {
  columnVisibility.value = {};
}

// A new search or filter starts from the first page. Filters are the caller's,
// so the table can only see them change through their tokens.
watch(
  () => [searchQuery.value, ...props.filters.map((filter) => filter.key)].join("\n"),
  () => {
    page.value = 1;
  },
);

// After rows disappear (a delete, a narrower filter), a page past the end shows the last one.
watch(
  [pageCount, () => props.isLoading],
  () => {
    if (!props.isLoading && page.value > pageCount.value) page.value = pageCount.value;
  },
  { immediate: true },
);

const isRefreshing = shallowRef(false);

async function handleRefresh(): Promise<void> {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    await props.refresh();
  } finally {
    isRefreshing.value = false;
  }
}

function handleClearAll(): void {
  search.value = "";
  emit("clearFilters");
}
</script>

<template>
  <section class="panel table-panel data-table" :aria-label="label">
    <div class="data-table__toolbar">
      <DataTableSearch
        v-model="search"
        class="data-table__search"
        :label="`Search ${label}`"
        :placeholder="searchPlaceholder"
      />
      <div class="data-table__tools">
        <slot name="controls" />
        <DataTableFilters
          v-if="$slots.filters"
          :active-count="filters.length"
          @clear-all="emit('clearFilters')"
        >
          <slot name="filters" />
        </DataTableFilters>
        <DataTableColumns
          :columns="hideableColumns"
          @toggle="handleColumnToggle"
          @reset="handleColumnsReset"
        />
        <button
          class="button data-table-tool"
          :class="{ 'data-table-tool--spinning': isRefreshing }"
          type="button"
          :aria-busy="isRefreshing"
          @click="handleRefresh"
        >
          <RefreshCw :size="14" aria-hidden="true" />
          <span class="data-table-tool__label">Refresh</span>
        </button>
      </div>
      <DataTablePagination
        v-if="isPaginatorShown"
        v-model:page="page"
        class="data-table__pagination"
        :row-count="rowCount"
        :page-count="pageCount"
      />
    </div>
    <ActiveFilters
      class="data-table__active-filters"
      :filters="activeFilters"
      @clear-all="handleClearAll"
    />

    <EmptyState v-if="error" :icon="CloudOff" tone="error">
      <strong>Couldn't load {{ label }}.</strong>
      <span>Check that the backend is running, then try again.</span>
      <button class="button data-table__retry" type="button" @click="handleRefresh">Retry</button>
    </EmptyState>
    <template v-else-if="!isLoading && !hasRows">
      <EmptyState v-if="hasQuery" :icon="SearchX">
        <strong>No results match.</strong>
        <button class="text-button" type="button" @click="handleClearAll">
          Clear search and filters
        </button>
      </EmptyState>
      <slot v-else name="empty" />
    </template>
    <template v-else>
      <div class="table-wrap">
        <table>
          <thead>
            <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
              <th v-for="header in headerGroup.headers" :key="header.id">
                <FlexRender v-if="!header.isPlaceholder" :header="header" />
              </th>
            </tr>
          </thead>
          <tbody>
            <LoadingRow v-if="isLoading" :columns="visibleColumnCount" />
            <template v-else>
              <tr
                v-for="row in table.getRowModel().rows"
                :key="row.id"
                :class="rowClass?.(row.original)"
              >
                <td v-for="cell in row.getVisibleCells()" :key="cell.id">
                  <slot :name="`cell-${cell.column.id}`" :row="row.original">
                    <FlexRender :cell="cell" />
                  </slot>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div v-if="isPaginatorShown" class="panel-footer data-table__footer">
        <DataTablePagination v-model:page="page" :row-count="rowCount" :page-count="pageCount" />
      </div>
    </template>
  </section>
</template>
