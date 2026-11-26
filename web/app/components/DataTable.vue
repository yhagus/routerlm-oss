<script setup lang="ts" generic="Row extends RowData">
import { CloudOff, RefreshCw, SearchX } from '@lucide/vue';
import {
  FlexRender,
  functionalUpdate,
  useTable,
  type ExpandedState,
  type ExpandedStateList,
  type PaginationState,
  type RowData,
  type Updater,
  type ColumnVisibilityState,
} from '@tanstack/vue-table';
import type { HTMLAttributes } from 'vue';
import { type ActiveFilter, searchFilterTokens } from '~/lib/activeFilters';
import {
  DATA_TABLE_PAGE_SIZE,
  dataTableFeatures,
  type DataTableColumn,
  type HideableColumn,
} from '~/lib/dataTable';

const props = withDefaults(
  defineProps<{
    tableId: string;
    label: string;
    columns: DataTableColumn<Row>[];
    rows: Row[];
    getRowId: (row: Row) => string;
    rowClass?: (row: Row) => HTMLAttributes['class'];
    columnClass?: (columnId: string) => HTMLAttributes['class'];
    isLoading: boolean;
    error?: unknown;
    refresh: () => Promise<unknown>;
    rowCount?: number;
    filters?: ActiveFilter[];
    searchPlaceholder?: string;
    getSubRows?: (row: Row) => Row[] | undefined;
    countLabel?: string;
  }>(),
  { filters: () => [], searchPlaceholder: 'Search' },
);
const emit = defineEmits<{ clearFilters: [] }>();
defineSlots<
  {
    controls?: () => unknown;
    filters?: () => unknown;
    empty?: () => unknown;
  } & {
    [cell: `cell-${string}`]: (props: {
      row: Row;
      isExpanded: boolean;
      toggleExpanded: () => void;
    }) => unknown;
  }
>();

const SEARCH_COMMIT_DELAY_MS = 300;

const committedSearch = useQuerySearch();
const page = useQueryPage();
const columnVisibility = useColumnVisibility(props.tableId);
const expanded = defineModel<ExpandedStateList>('expanded', { default: () => ({}) });

const searchText = shallowRef(committedSearch.value);
let lastCommittedSearch = committedSearch.value;
let searchCommitTimer: ReturnType<typeof setTimeout> | undefined;

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

watch(committedSearch, (text) => {
  if (text === lastCommittedSearch) return;
  lastCommittedSearch = text;
  clearTimeout(searchCommitTimer);
  searchText.value = text;
});
onScopeDispose(() => clearTimeout(searchCommitTimer));

const searchForTokens = computed({
  get: () => committedSearch.value,
  set: commitSearch,
});

const isServerMode = computed(() => props.rowCount !== undefined);
const searchQuery = computed(() => committedSearch.value.trim());
const hasQuery = computed(() => searchQuery.value !== '' || props.filters.length > 0);
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
    expanded: expanded.value,
  })),
  manualPagination: isServerMode,
  manualFiltering: isServerMode,
  autoResetPageIndex: false,
  getSubRows: props.getSubRows,
  filterFromLeafRows: props.getSubRows !== undefined,
  paginateExpandedRows: false,
  autoResetExpanded: false,
  onPaginationChange: (updater: Updater<PaginationState>) => {
    page.value = functionalUpdate(updater, pagination.value).pageIndex + 1;
  },
  onExpandedChange: (updater: Updater<ExpandedState>) => {
    const next = functionalUpdate(updater, expanded.value);
    if (next !== true) expanded.value = next;
  },
  onColumnVisibilityChange: (updater: Updater<ColumnVisibilityState>) => {
    columnVisibility.value = functionalUpdate(updater, columnVisibility.value);
  },
});

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
      label: typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id,
      isVisible: column.getIsVisible(),
    })),
);

function handleColumnToggle(columnId: string, isVisible: boolean): void {
  table.getColumn(columnId)?.toggleVisibility(isVisible);
}

function handleColumnsReset(): void {
  columnVisibility.value = {};
}

watch(
  () => props.filters.map((filter) => filter.key).join('\n'),
  () => {
    page.value = 1;
  },
);

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
  commitSearch('');
  emit('clearFilters');
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
        :count-label="countLabel"
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
              <th
                v-for="header in headerGroup.headers"
                :key="header.id"
                :class="columnClass?.(header.column.id)"
              >
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
                :class="[rowClass?.(row.original), { 'data-table__sub-row': row.depth > 0 }]"
              >
                <td
                  v-for="cell in row.getVisibleCells()"
                  :key="cell.id"
                  :class="columnClass?.(cell.column.id)"
                >
                  <slot
                    :name="`cell-${cell.column.id}`"
                    :row="row.original"
                    :is-expanded="row.getIsExpanded()"
                    :toggle-expanded="() => row.toggleExpanded()"
                  >
                    <FlexRender :cell="cell" />
                  </slot>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div v-if="isPaginatorShown" class="panel-footer data-table__footer">
        <DataTablePagination
          v-model:page="page"
          :row-count="totalRows"
          :page-count="pageCount"
          :count-label="countLabel"
        />
      </div>
    </template>
  </section>
</template>
