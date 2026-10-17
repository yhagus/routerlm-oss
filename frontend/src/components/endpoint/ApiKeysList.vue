<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { ApiKey, ApiKeyPagination } from "@/types/api";
import { number } from "@/lib/format";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Toggle from "@/components/ui/toggle.vue";
import Badge from "@/components/ui/badge.vue";
import TabSwitcher from "@/components/ui/tab-switcher.vue";
import TableSkeleton from "@/components/ui/table-skeleton.vue";
import Select from "@/components/ui/select.vue";

const EMPTY_USAGE = {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};
const pageSizeOptions = [10, 20, 50].map((size) => ({
  value: size,
  label: String(size),
}));

const props = withDefaults(
  defineProps<{
    keys: ApiKey[];
    pagination: ApiKeyPagination;
    searchInput: string;
    visibilityTab: "private" | "public" | "event";
    loading?: boolean;
  }>(),
  { loading: false },
);

const emit = defineEmits<{
  search: [value: string];
  page: [value: number];
  pageSize: [value: number];
  visibility: [value: "private" | "public" | "event"];
  create: [];
  copy: [key: ApiKey];
  toggle: [key: ApiKey, value: boolean];
  pause: [key: ApiKey, value: boolean];
  editCombo: [key: ApiKey];
  editModel: [key: ApiKey];
  setDefault: [key: ApiKey];
  editLimit: [key: ApiKey];
  resetUsage: [key: ApiKey];
  openStats: [key: ApiKey];
  showTracker: [key: ApiKey];
  delete: [key: ApiKey];
  submit: [key: ApiKey];
  revoke: [key: ApiKey];
  editPins: [key: ApiKey];
}>();

const openMenuId = ref<string | null>(null);
const menuAnchor = ref<HTMLElement | null>(null);
const menuElement = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});
const activeKey = computed(
  () => props.keys.find((key) => key.id === openMenuId.value) || null,
);

const totalPages = computed(() =>
  Math.max(
    1,
    props.pagination.totalPages ||
      Math.ceil(
        (props.pagination.totalItems || 0) / (props.pagination.pageSize || 10),
      ),
  ),
);
const pageNumbers = computed(() => {
  const current = props.pagination.page;
  const end = Math.min(totalPages.value, Math.max(1, current - 2) + 4);
  const start = Math.max(1, Math.min(Math.max(1, current - 2), end - 4));
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});
const hasKeys = computed(() => props.keys.length > 0);
const visibilityTabs = [
  { value: "private", label: "Private" },
  { value: "public", label: "Public" },
  { value: "event", label: "Event" },
] as const;
const skeletonColumns = [
  { width: "20%", lines: 2 },
  { width: "30%" },
  { width: "22%", align: "end", lines: 2 },
  { width: "10%", align: "end" },
  { width: "18%", align: "end" },
] as const;
// Skeleton only when there is nothing to show. A refetch with rows on screen
// (page, search, sort) keeps them visible and dimmed instead of flashing.
const viewState = computed<"skeleton" | "empty" | "table">(() =>
  props.loading && !hasKeys.value
    ? "skeleton"
    : !hasKeys.value
      ? "empty"
      : "table",
);
const skeletonRows = computed(() =>
  Math.min(Math.max(props.pagination.pageSize || 5, 3), 6),
);
const hasSearch = computed(() => Boolean(props.searchInput.trim()));
const tabLabel = computed(() =>
  props.visibilityTab === "public"
    ? "public"
    : props.visibilityTab === "event"
      ? "event"
      : "private",
);

function formatCompact(value: unknown): string {
  const current = Number(value) || 0;
  if (current >= 1_000_000_000_000)
    return `${(current / 1_000_000_000_000).toFixed(current >= 10_000_000_000_000 ? 0 : 1)}T`;
  if (current >= 1_000_000_000)
    return `${(current / 1_000_000_000).toFixed(current >= 10_000_000_000 ? 0 : 1)}B`;
  if (current >= 1_000_000)
    return `${(current / 1_000_000).toFixed(current >= 10_000_000 ? 0 : 1)}M`;
  if (current >= 1_000)
    return `${(current / 1_000).toFixed(current >= 10_000 ? 0 : 1)}k`;
  return String(current);
}

function usageFor(key: ApiKey) {
  return key.usage || EMPTY_USAGE;
}

function comboMode(key: ApiKey) {
  return key.comboAccessMode === "whitelist" ? "WL" : "BL";
}

function modelMode(key: ApiKey) {
  return key.modelAccessMode === "blacklist" ? "BL" : "WL";
}

function listCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function dateLabel(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleDateString();
}

function limitReached(key: ApiKey) {
  if (key.limitMode === "tokens")
    return (key.usageTokens || 0) >= (key.limitValue || 0);
  return (key.usageRequests || 0) >= (key.limitValue || 0);
}

function onToggle(key: ApiKey, value: boolean) {
  if (key.isActive && !value) emit("pause", key, value);
  else emit("toggle", key, value);
}

function openActions(key: ApiKey, event: MouseEvent) {
  if (openMenuId.value === key.id) {
    closeActions();
    return;
  }
  const button = event.currentTarget as HTMLElement;
  menuAnchor.value = button;
  openMenuId.value = key.id;
  const rect = button.getBoundingClientRect();
  menuStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${Math.max(4, rect.right - 180)}px`,
    width: "180px",
  };
  nextTick(() => {
    const menu = menuElement.value;
    const anchor = menuAnchor.value;
    if (!menu || !anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const openUp =
      window.innerHeight - anchorRect.bottom < menuRect.height + 4 &&
      anchorRect.top > window.innerHeight - anchorRect.bottom;
    menuStyle.value = {
      top: `${Math.max(4, openUp ? anchorRect.top - menuRect.height - 4 : Math.min(window.innerHeight - menuRect.height - 4, anchorRect.bottom + 4))}px`,
      left: `${Math.max(4, Math.min(window.innerWidth - menuRect.width - 4, anchorRect.right - menuRect.width))}px`,
      width: `${menuRect.width}px`,
    };
  });
}

function closeActions() {
  openMenuId.value = null;
  menuAnchor.value = null;
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node;
  if (menuElement.value?.contains(target) || menuAnchor.value?.contains(target))
    return;
  closeActions();
}

function runAction(action: () => void) {
  closeActions();
  action();
}

function selectAction(
  action:
    | "editCombo"
    | "editModel"
    | "setDefault"
    | "editLimit"
    | "resetUsage"
    | "openStats"
    | "showTracker"
    | "editPins"
    | "submit"
    | "revoke"
    | "delete",
) {
  const key = activeKey.value;
  if (!key) return;
  runAction(() => {
    if (action === "editCombo") emit("editCombo", key);
    else if (action === "editModel") emit("editModel", key);
    else if (action === "setDefault") emit("setDefault", key);
    else if (action === "editLimit") emit("editLimit", key);
    else if (action === "resetUsage") emit("resetUsage", key);
    else if (action === "openStats") emit("openStats", key);
    else if (action === "showTracker") emit("showTracker", key);
    else if (action === "editPins") emit("editPins", key);
    else if (action === "submit") emit("submit", key);
    else if (action === "revoke") emit("revoke", key);
    else emit("delete", key);
  });
}

function isEvent(key: ApiKey | null): boolean {
  return key?.visibility === "event";
}

function isDraft(key: ApiKey | null): boolean {
  return isEvent(key) && key?.status === "draft";
}

function isSubmitted(key: ApiKey | null): boolean {
  return isEvent(key) && key?.status === "submitted";
}

function isRevoked(key: ApiKey | null): boolean {
  return isEvent(key) && key?.status === "revoked";
}

// Draft event keys are fully editable; submitted keys are locked (revoke
// only); revoked keys are frozen. Non-event keys always allow edits.
function canEdit(key: ApiKey | null): boolean {
  if (!isEvent(key)) return true;
  return isDraft(key);
}

function canDelete(key: ApiKey | null): boolean {
  if (!isEvent(key)) return true;
  return isDraft(key);
}

function canOpenStats(key: ApiKey | null): boolean {
  if (!key || key.isActive === false) return false;
  if (isEvent(key)) return isSubmitted(key);
  return key.visibility === "public";
}

function showSetDefault() {
  return (
    activeKey.value?.visibility === "public" &&
    activeKey.value.isDefault !== true
  );
}

function showResetUsage() {
  const key = activeKey.value;
  return Boolean(
    key?.limitMode && key.limitMode !== "none" && Number(key.limitValue) > 0,
  );
}

function changePageSize(value: string | number) {
  emit("pageSize", Number(value));
}

onMounted(() => document.addEventListener("click", onDocumentClick));
onUnmounted(() => document.removeEventListener("click", onDocumentClick));
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <TabSwitcher
        :model-value="visibilityTab"
        :options="visibilityTabs"
        @update:model-value="emit('visibility', $event)"
      />
      <div class="flex min-w-0 flex-1 gap-2">
        <div class="relative min-w-0 flex-1">
          <span
            class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-muted-foreground"
            >search</span
          >
          <Input
            :model-value="searchInput"
            placeholder="Search by name..."
            class="pl-10"
            @update:model-value="emit('search', String($event ?? ''))"
          />
        </div>
        <Button class="shrink-0" @click="emit('create')"
          ><span class="material-symbols-outlined text-[18px]">add</span>Create
          Key</Button
        >
      </div>
    </div>

    <Transition name="keys-swap" mode="out-in">
      <div :key="viewState" :aria-busy="loading">
        <TableSkeleton
          v-if="viewState === 'skeleton'"
          :columns="skeletonColumns"
          :rows="skeletonRows"
          label="Loading API keys"
        />
        <div v-else-if="viewState === 'empty'" class="py-6 text-center">
          <p class="mb-1 text-sm font-medium">
            {{
              hasSearch ? "No matching API keys" : `No ${tabLabel} API keys yet`
            }}
          </p>
          <p class="mb-3 text-xs text-muted-foreground">
            {{
              hasSearch
                ? "Try a different name or clear the search"
                : `Create a ${tabLabel} API key to get started`
            }}
          </p>
        </div>
        <template v-else>
          <div
            class="overflow-x-auto rounded-lg border transition-opacity duration-150"
            :class="loading ? 'pointer-events-none opacity-60' : ''"
          >
            <table class="w-full min-w-[720px] text-left">
              <thead>
                <tr
                  class="border-b bg-muted/60 text-[10px] text-muted-foreground"
                >
                  <th class="font-semibold w-[20%] px-5 py-2.5">Name</th>
                  <th class="font-semibold w-[30%] px-5 py-2.5">Key</th>
                  <th class="font-semibold w-[22%] px-5 py-2.5 text-right">
                    Tokens
                  </th>
                  <th class="font-semibold w-[10%] px-5 py-2.5 text-right">
                    Req
                  </th>
                  <th class="font-semibold w-[18%] px-5 py-2.5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="key in keys"
                  :key="key.id"
                  class="group border-b border-border/60 last:border-b-0 hover:bg-muted/50"
                  :class="key.isActive === false ? 'opacity-60' : ''"
                >
                  <td class="px-3.75 py-[7.5px] align-middle">
                    <div class="flex min-w-0 items-center gap-1.5">
                      <span
                        class="truncate text-sm font-medium"
                        :title="key.name || ''"
                        >{{ key.name || "Unnamed key" }}</span
                      >
                      <Badge v-if="key.visibility === 'public'" variant="info"
                        >Public</Badge
                      >
                      <Badge
                        v-else-if="key.visibility === 'event'"
                        variant="info"
                        >Event</Badge
                      >
                      <Badge v-else variant="secondary">Private</Badge>
                      <Badge
                        v-if="
                          key.visibility === 'event' && key.status === 'draft'
                        "
                        variant="secondary"
                        >Draft</Badge
                      >
                      <Badge
                        v-else-if="
                          key.visibility === 'event' &&
                          key.status === 'submitted'
                        "
                        variant="success"
                        >Submitted</Badge
                      >
                      <Badge
                        v-else-if="
                          key.visibility === 'event' && key.status === 'revoked'
                        "
                        variant="destructive"
                        >Revoked</Badge
                      >
                      <Badge
                        v-if="key.visibility === 'public' && key.isDefault"
                        variant="warning"
                        >Default</Badge
                      >
                      <Badge v-if="key.isActive === false" variant="warning"
                        >Paused</Badge
                      >
                    </div>
                    <p class="mt-0.5 text-[10px] text-muted-foreground">
                      {{ dateLabel(key.createdAt) }} · C:{{ comboMode(key)
                      }}<span v-if="listCount(key.comboAccessList)"
                        >({{ listCount(key.comboAccessList) }})</span
                      >
                      / M:{{ modelMode(key)
                      }}<span v-if="listCount(key.modelAccessList)"
                        >({{ listCount(key.modelAccessList) }})</span
                      >
                      <template
                        v-if="
                          key.limitMode &&
                          key.limitMode !== 'none' &&
                          Number(key.limitValue) > 0
                        "
                      >
                        ·
                        <span :class="limitReached(key) ? 'text-red-500' : ''"
                          >Limit:
                          {{
                            key.limitMode === "tokens"
                              ? `${formatCompact(key.usageTokens)}/${formatCompact(key.limitValue)} tok`
                              : `${formatCompact(key.usageRequests)}/${formatCompact(key.limitValue)} req`
                          }}</span
                        >
                      </template>
                      <template v-if="Number(key.maxConcurrency) > 0">
                        · Max {{ key.maxConcurrency }} concurrent
                      </template>
                    </p>
                  </td>
                  <td class="px-3.75 py-[7.5px] align-middle">
                    <div class="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Copy API key"
                        title="Copy API key"
                        @click="emit('copy', key)"
                        ><span class="material-symbols-outlined text-[16px]"
                          >content_copy</span
                        ></Button
                      >
                      <Button
                        v-if="canOpenStats(key)"
                        variant="ghost"
                        size="icon"
                        aria-label="Open usage stats"
                        title="Open usage stats in a new tab"
                        @click="emit('openStats', key)"
                        ><span class="material-symbols-outlined text-[16px]"
                          >open_in_new</span
                        ></Button
                      >
                    </div>
                  </td>
                  <td
                    class="px-3.75 py-[7.5px] text-right align-middle"
                    :title="`${number(usageFor(key).totalTokens)} total · ${number(usageFor(key).promptTokens)} in · ${number(usageFor(key).completionTokens)} out`"
                  >
                    <div class="font-mono text-sm font-medium">
                      {{ formatCompact(usageFor(key).totalTokens) }}
                    </div>
                    <div class="font-mono text-[10px] text-muted-foreground">
                      {{ formatCompact(usageFor(key).promptTokens) }} in ·
                      {{ formatCompact(usageFor(key).completionTokens) }} out
                    </div>
                  </td>
                  <td class="px-3.75 py-[7.5px] text-right align-middle">
                    <span
                      class="font-mono text-sm"
                      :title="`${number(usageFor(key).requests)} requests`"
                      >{{ formatCompact(usageFor(key).requests) }}</span
                    >
                  </td>
                  <td class="px-3.75 py-[7.5px] align-middle">
                    <div class="flex items-center justify-end gap-1">
                      <Toggle
                        v-if="key.visibility !== 'event'"
                        size="sm"
                        :checked="key.isActive !== false"
                        :title="
                          key.isActive !== false ? 'Pause key' : 'Resume key'
                        "
                        @change="(value: boolean) => onToggle(key, value)"
                      />
                      <button
                        type="button"
                        class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                        title="More actions"
                        aria-haspopup="menu"
                        :aria-expanded="openMenuId === key.id"
                        @click.stop="openActions(key, $event)"
                      >
                        <span class="material-symbols-outlined text-[18px]"
                          >more_vert</span
                        >
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            v-if="pagination.totalItems > 0"
            class="flex flex-col items-center justify-between gap-4 px-1 py-3 sm:flex-row"
          >
            <div class="text-sm text-muted-foreground">
              Showing
              <span class="font-medium text-foreground">{{
                (pagination.page - 1) * pagination.pageSize + 1
              }}</span>
              to
              <span class="font-medium text-foreground">{{
                Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.totalItems,
                )
              }}</span>
              of
              <span class="font-medium text-foreground">{{
                pagination.totalItems
              }}</span>
              results
            </div>
            <div
              class="flex flex-wrap items-center justify-center gap-2 sm:gap-4"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm text-muted-foreground">Rows:</span
                ><Select
                  :model-value="pagination.pageSize"
                  :options="pageSizeOptions"
                  class="h-9 w-auto min-w-16"
                  aria-label="Rows per page"
                  @update:model-value="changePageSize"
                />
              </div>
              <div v-if="totalPages > 1" class="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  class="w-9 px-0"
                  :disabled="pagination.page === 1"
                  @click="emit('page', pagination.page - 1)"
                  ><span class="material-symbols-outlined text-[18px]"
                    >chevron_left</span
                  ></Button
                >
                <template v-if="pageNumbers[0] > 1"
                  ><Button
                    variant="ghost"
                    size="sm"
                    class="hidden w-9 px-0 sm:inline-flex"
                    @click="emit('page', 1)"
                    >1</Button
                  ><span
                    v-if="pageNumbers[0] > 2"
                    class="hidden px-1 text-muted-foreground sm:inline"
                    >...</span
                  ></template
                >
                <Button
                  v-for="currentPage in pageNumbers"
                  :key="currentPage"
                  :variant="
                    pagination.page === currentPage ? 'default' : 'ghost'
                  "
                  size="sm"
                  class="w-9 px-0"
                  :class="
                    pagination.page !== currentPage
                      ? 'hidden sm:inline-flex'
                      : ''
                  "
                  @click="emit('page', currentPage)"
                  >{{ currentPage }}</Button
                >
                <template
                  v-if="pageNumbers[pageNumbers.length - 1] < totalPages"
                  ><span
                    v-if="pageNumbers[pageNumbers.length - 1] < totalPages - 1"
                    class="hidden px-1 text-muted-foreground sm:inline"
                    >...</span
                  ><Button
                    variant="ghost"
                    size="sm"
                    class="hidden w-9 px-0 sm:inline-flex"
                    @click="emit('page', totalPages)"
                    >{{ totalPages }}</Button
                  ></template
                >
                <Button
                  variant="outline"
                  size="sm"
                  class="w-9 px-0"
                  :disabled="pagination.page === totalPages"
                  @click="emit('page', pagination.page + 1)"
                  ><span class="material-symbols-outlined text-[18px]"
                    >chevron_right</span
                  ></Button
                >
              </div>
            </div>
          </div>
        </template>
      </div>
    </Transition>

    <Teleport to="body">
      <div
        v-if="openMenuId"
        ref="menuElement"
        role="menu"
        class="fixed z-[100] rounded-lg border bg-background py-1 shadow-lg"
        :style="menuStyle"
        @click.stop
      >
        <button
          v-if="canEdit(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          @click="selectAction('editCombo')"
        >
          <span
            class="material-symbols-outlined text-[16px] text-muted-foreground"
            >rule</span
          >Combo access
        </button>
        <button
          v-if="canEdit(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          @click="selectAction('editModel')"
        >
          <span
            class="material-symbols-outlined text-[16px] text-muted-foreground"
            >model_training</span
          >Model access
        </button>
        <button
          v-if="isDraft(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          @click="selectAction('editPins')"
        >
          <span
            class="material-symbols-outlined text-[16px] text-muted-foreground"
            >cable</span
          >Connection pins
        </button>
        <button
          v-if="showSetDefault()"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          @click="selectAction('setDefault')"
        >
          <span
            class="material-symbols-outlined text-[16px] text-muted-foreground"
            >star</span
          >Set as default
        </button>
        <button
          v-if="canEdit(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          @click="selectAction('editLimit')"
        >
          <span
            class="material-symbols-outlined text-[16px] text-muted-foreground"
            >speed</span
          >Usage limit
        </button>
        <button
          v-if="showResetUsage() && canEdit(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          @click="selectAction('resetUsage')"
        >
          <span
            class="material-symbols-outlined text-[16px] text-muted-foreground"
            >restart_alt</span
          >Reset usage
        </button>
        <button
          v-if="isDraft(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-emerald-600 hover:bg-accent dark:text-emerald-400"
          @click="selectAction('submit')"
        >
          <span class="material-symbols-outlined text-[16px]">send</span>Submit
          key
        </button>
        <button
          v-if="isSubmitted(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
          @click="selectAction('revoke')"
        >
          <span class="material-symbols-outlined text-[16px]">block</span>Revoke
          key
        </button>
        <button
          v-if="canOpenStats(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          @click="selectAction('openStats')"
        >
          <span
            class="material-symbols-outlined text-[16px] text-muted-foreground"
            >open_in_new</span
          >Open usage stats
        </button>
        <button
          v-if="canEdit(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          @click="selectAction('showTracker')"
        >
          <span
            class="material-symbols-outlined text-[16px] text-muted-foreground"
            >monitoring</span
          >Show Tracker
        </button>
        <div v-if="canDelete(activeKey)" class="my-1 border-t" />
        <button
          v-if="canDelete(activeKey)"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
          @click="selectAction('delete')"
        >
          <span class="material-symbols-outlined text-[16px]">delete</span
          >Delete key
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.keys-swap-enter-active,
.keys-swap-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}
.keys-swap-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.keys-swap-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .keys-swap-enter-active,
  .keys-swap-leave-active {
    transition: none;
  }
  .keys-swap-enter-from {
    transform: none;
  }
}
</style>
