<script setup lang="ts" generic="Row extends RowData">
/**
 * A list in a table panel: a toolbar (search, the caller's extra controls,
 * Filters, Columns, Refresh, paginator), the active-filter tokens, then the
 * rows, 50 to a page. Search (`?q=`) and page (`?page=`) live in the URL.
 *
 * The search field holds what is being typed; once typing pauses for 300ms
 * the text is committed to `?q=` together with a return to page 1, in one URL
 * change. `?q=` is the only search the rows follow, so a server-mode page
 * fetches once per committed search, and back/forward restores the field.
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
 * The caller reads the same URL state, `useQuerySearch()` and
 * `useQueryPage()`, puts it in its request, and gets the page back. Changing
 * the search or a filter returns to page 1.
 *
 *   const search = useQuerySearch();
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

const SEARCH_COMMIT_DELAY_MS = 300;

const committedSearch = useQuerySearch();
const page = useQueryPage();
const columnVisibility = useColumnVisibility(props.tableId);

/** The field's text, ahead of `committedSearch` while typing. */
const searchText = shallowRef(committedSearch.value);
/** What this table last committed, so its own commit reaching the URL isn't taken for back/forward. */
let lastCommittedSearch = committedSearch.value;
let searchCommitTimer: ReturnType<typeof setTimeout> | undefined;

/** Applies `text` as the search; a different search starts from the first page. */
function commitSearch(text: string): void {
  clearTimeout(searchCommitTimer);
  searchText.value = text;
  if (text.trim() === lastCommittedSearch.trim()) return;
  lastCommittedSearch = text;
  committedSearch.value = text;
  page.value = 1;
}

function handleSearchInput(text: string): void {
  searchText.value = text;
  clearTimeout(searchCommitTimer);
  searchCommitTimer = setTimeout(() => commitSearch(text), SEARCH_COMMIT_DELAY_MS);
}

// Back/forward or a link changed `?q=`: the URL already holds its page, so only the field follows.
watch(committedSearch, (text) => {
  if (text === lastCommittedSearch) return;
  lastCommittedSearch = text;
  clearTimeout(searchCommitTimer);
  searchText.value = text;
});
onScopeDispose(() => clearTimeout(searchCommitTimer));

/** The search token's remove and Clear all apply at once, without the typing delay. */
const searchForTokens = computed({
  get: () => committedSearch.value,
  set: commitSearch,
});

const isServerMode = computed(() => props.rowCount !== undefined);
const searchQuery = computed(() => committedSearch.value.trim());
const hasQuery = computed(() => searchQuery.value !== "" || props.filters.length > 0);
const activeFilters = computed(() => [...searchFilterTokens(searchForTokens), ...props.filters]);

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
const totalRows = computed(() => props.rowCount ?? table.getFilteredRowModel().rows.length);
const pageCount = computed(() => Math.max(1, Math.ceil(totalRows.value / DATA_TABLE_PAGE_SIZE)));
const visibleColumnCount = computed(() => table.getVisibleLeafColumns().length);
const hasRows = computed(() => totalRows.value > 0);
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

// A new filter starts from the first page (a new search does so in `commitSearch`). Filters are
// the caller's, so the table can only see them change through their tokens.
watch(
  () => props.filters.map((filter) => filter.key).join("\n"),
  () => {
    page.value = 1;
  },
);

// After rows disappear (a delete, a narrower filter), a page past the end shows the last one.
// Only a loaded total counts: before the first load, or while a load has failed, the row count
// is 0 and would send the reader, and Retry, back to page 1.
watch(
  [pageCount, () => props.isLoading, () => props.error],
  () => {
    if (props.isLoading || props.error) return;
    if (page.value > pageCount.value) page.value = pageCount.value;
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
  commitSearch("");
  emit("clearFilters");
}
</script>

<template>
  <section class="panel table-panel data-table" :aria-label="label">
    <div class="data-table__toolbar">
      <DataTableSearch
        :model-value="searchText"
        class="data-table__search"
        :label="`Search ${label}`"
        :placeholder="searchPlaceholder"
        @update:model-value="handleSearchInput"
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
        :row-count="totalRows"
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
        <DataTablePagination v-model:page="page" :row-count="totalRows" :page-count="pageCount" />
      </div>
    </template>
  </section>
</template>
