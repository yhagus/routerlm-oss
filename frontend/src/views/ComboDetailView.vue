<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Edit3,
  Folder,
  FolderX,
  Layers3,
  Save,
  SkipForward,
} from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import {
  accountGroupFilterToken,
  accountGroupNameFromFilter,
  comboAccountFilters,
  comboModels,
  comboUsesCustomOrder,
  groupConnections,
  resolveModelProvider,
} from "@/lib/routing";
import type { ProviderConnection } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import { useNotificationStore } from "@/stores/notifications";

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const notices = useNotificationStore();
const id = computed(() => String(route.params.id || ""));
const combo = useQuery({
  queryKey: ["combo", id],
  queryFn: () => api.combos.get(id.value),
});
const providers = useQuery({
  queryKey: ["providers"],
  queryFn: api.providers.list,
});
const nodes = useQuery({
  queryKey: ["provider-nodes"],
  queryFn: api.nodes.list,
});
const aliases = useQuery({
  queryKey: ["model-aliases"],
  queryFn: api.models.aliases,
});
const filters = ref<Record<string, string[]>>({});
const useCustomOrder = ref(false);

watch(
  () => combo.data.value,
  (value) => {
    if (!value) return;
    filters.value = comboAccountFilters(value);
    useCustomOrder.value = comboUsesCustomOrder(value);
  },
  { immediate: true },
);

const modelEntries = computed(() => comboModels(combo.data.value));
const accountList = computed(() => providers.data.value || []);
const nodeList = computed(() => nodes.data.value || []);
const aliasMap = computed(() => aliases.data.value || {});

function providerFor(modelEntry: string) {
  return resolveModelProvider(modelEntry, nodeList.value, aliasMap.value);
}

function accountsFor(modelEntry: string): ProviderConnection[] {
  const providerId = providerFor(modelEntry).providerId;
  return accountList.value.filter(
    (connection) => connection.provider === providerId && connection.isActive,
  );
}

function allIds(modelEntry: string) {
  return accountsFor(modelEntry).map((connection) => connection.id);
}

function hasFilter(modelEntry: string) {
  return Object.prototype.hasOwnProperty.call(filters.value, modelEntry);
}

function selectedIds(modelEntry: string) {
  const selected = new Set(manualIds(modelEntry));
  for (const group of selectedGroupNames(modelEntry)) {
    for (const connection of accountsFor(modelEntry)) {
      if (groupConnections([connection])[0]?.name === group)
        selected.add(connection.id);
    }
  }
  return [...selected];
}

function selectedGroupNames(modelEntry: string) {
  return (filters.value[modelEntry] || [])
    .map(accountGroupNameFromFilter)
    .filter((group): group is string => Boolean(group));
}

function manualIds(modelEntry: string) {
  return hasFilter(modelEntry)
    ? (filters.value[modelEntry] || []).filter(
        (value) => !accountGroupNameFromFilter(value),
      )
    : allIds(modelEntry);
}

function groupIsDynamic(modelEntry: string, groupName: string) {
  return selectedGroupNames(modelEntry).includes(groupName);
}

function setFilter(
  modelEntry: string,
  ids: string[],
  groups = selectedGroupNames(modelEntry),
) {
  const next = { ...filters.value };
  const values = [...new Set([...ids, ...groups.map(accountGroupFilterToken)])];
  if (!groups.length && ids.length === allIds(modelEntry).length)
    delete next[modelEntry];
  else next[modelEntry] = values;
  filters.value = next;
}

function statusFor(modelEntry: string) {
  if (!hasFilter(modelEntry)) return "All active accounts";
  const count = selectedIds(modelEntry).length;
  return count === 0 ? "Skipped" : `${count} selected`;
}

function orderedAccounts(modelEntry: string) {
  const accounts = [...accountsFor(modelEntry)];
  if (!useCustomOrder.value || !hasFilter(modelEntry)) return accounts;
  const selected = selectedIds(modelEntry);
  return accounts.sort((a, b) => {
    const aIndex = selected.indexOf(a.id);
    const bIndex = selected.indexOf(b.id);
    return (
      (aIndex < 0 ? Number.POSITIVE_INFINITY : aIndex) -
      (bIndex < 0 ? Number.POSITIVE_INFINITY : bIndex)
    );
  });
}

function selectAll(modelEntry: string) {
  const next = { ...filters.value };
  delete next[modelEntry];
  filters.value = next;
}

function skip(modelEntry: string) {
  filters.value = { ...filters.value, [modelEntry]: [] };
}

function toggleAccount(modelEntry: string, connectionId: string) {
  const selected = new Set(manualIds(modelEntry));
  if (selected.has(connectionId)) selected.delete(connectionId);
  else selected.add(connectionId);
  setFilter(modelEntry, [...selected]);
}

function toggleGroup(modelEntry: string, groupIds: string[]) {
  const selected = new Set(manualIds(modelEntry));
  const selecting = groupIds.some((id) => !selected.has(id));
  for (const id of groupIds) selecting ? selected.add(id) : selected.delete(id);
  setFilter(modelEntry, [...selected]);
}

function toggleDynamicGroup(
  modelEntry: string,
  groupName: string,
  groupIds: string[],
) {
  const groups = new Set(selectedGroupNames(modelEntry));
  const manual = new Set(manualIds(modelEntry));
  if (groups.has(groupName)) {
    groups.delete(groupName);
    for (const id of groupIds) manual.add(id);
  } else {
    groups.add(groupName);
    for (const id of groupIds) manual.delete(id);
  }
  setFilter(modelEntry, [...manual], [...groups]);
}

function moveAccount(modelEntry: string, index: number, direction: -1 | 1) {
  const selected = [...selectedIds(modelEntry)];
  const target = index + direction;
  if (target < 0 || target >= selected.length) return;
  [selected[index], selected[target]] = [selected[target], selected[index]];
  setFilter(modelEntry, selected);
}

function groupIsChecked(modelEntry: string, ids: string[]) {
  const selected = selectedIds(modelEntry);
  return ids.length > 0 && ids.every((id) => selected.includes(id));
}

function groupIsIndeterminate(modelEntry: string, ids: string[]) {
  const selectedCount = ids.filter((id) =>
    selectedIds(modelEntry).includes(id),
  ).length;
  return selectedCount > 0 && selectedCount < ids.length;
}

function groupSelectedCount(modelEntry: string, ids: string[]) {
  return ids.filter((id) => selectedIds(modelEntry).includes(id)).length;
}

function hasNamedGroups(modelEntry: string) {
  return groupConnections(orderedAccounts(modelEntry)).some(
    (group) => group.name !== "Ungrouped",
  );
}

const save = useMutation({
  mutationFn: () =>
    api.combos.update(id.value, {
      accountFilters: filters.value,
      useCustomAccountOrder: useCustomOrder.value,
    }),
  onSuccess: async (updated) => {
    queryClient.setQueryData(["combo", id], updated);
    queryClient.invalidateQueries({ queryKey: ["combos"] });
    notices.push("success", "Combo account routing saved.");
    await router.push("/dashboard/combos");
  },
  onError: (error) =>
    notices.push("error", error.message, "Could not save combo routing"),
});
</script>

<template>
  <div v-if="combo.isPending.value" class="space-y-6">
    <div class="h-16 animate-pulse rounded-xl bg-muted" />
    <div
      v-for="item in 3"
      :key="item"
      class="h-40 animate-pulse rounded-xl bg-muted"
    />
  </div>
  <div v-else-if="combo.isError.value || !combo.data.value" class="space-y-6">
    <PageHeader
      title="Combo accounts"
      description="The requested fallback combo could not be loaded."
    /><EmptyState
      title="Combo not found"
      description="This combo may have been removed or the route id is invalid."
      ><Button @click="router.push('/dashboard/combos')"
        ><ArrowLeft class="size-4" />Back to combos</Button
      ></EmptyState
    >
  </div>
  <div v-else class="space-y-6">
    <PageHeader
      :title="`Account routing: ${combo.data.value.name}`"
      description="Choose which active provider accounts each model may use and optionally control their order."
    >
      <template #actions
        ><Button
          variant="outline"
          size="sm"
          @click="router.push('/dashboard/combos')"
          ><ArrowLeft class="size-4" />Combos</Button
        ><Button
          variant="outline"
          size="sm"
          @click="
            router.push({ path: '/dashboard/combos', query: { edit: id } })
          "
          ><Edit3 class="size-4" />Edit combo</Button
        ><Button
          size="sm"
          :disabled="save.isPending.value"
          @click="save.mutate()"
          ><Save class="size-4" />{{
            save.isPending.value ? "Saving..." : "Save routing"
          }}</Button
        ></template
      >
    </PageHeader>

    <Card class="p-5">
      <div class="flex items-start gap-3">
        <div
          class="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"
        >
          <Layers3 class="size-4" />
        </div>
        <div>
          <h2 class="text-sm font-semibold">{{ combo.data.value.name }}</h2>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">
            {{
              combo.data.value.identityEnabled ||
              combo.data.value.identity_enabled
                ? "This combo name is used as the assistant identity. "
                : ""
            }}No saved filter means every active account for that model. An
            explicit empty selection skips the model during combo execution.
          </p>
        </div>
      </div>
      <label class="mt-5 flex items-start gap-3 border-t pt-4"
        ><input
          v-model="useCustomOrder"
          type="checkbox"
          class="mt-0.5 size-4 accent-primary"
        /><span
          ><span class="block text-sm font-medium"
            >Use custom account order</span
          ><span class="mt-1 block text-xs leading-5 text-muted-foreground"
            >When enabled, selected accounts are tried top to bottom for each
            model. Otherwise the provider priority is used.</span
          ></span
        ></label
      >
    </Card>

    <EmptyState
      v-if="!modelEntries.length"
      title="No models in this combo"
      description="Add at least one model to the combo before configuring account routing."
    />
    <div v-else class="space-y-4">
      <Card
        v-for="(modelEntry, modelIndex) in modelEntries"
        :key="`${modelEntry}-${modelIndex}`"
        class="overflow-hidden"
      >
        <div
          class="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div class="min-w-0">
            <code class="block truncate text-sm font-semibold">{{
              modelEntry
            }}</code>
            <p class="mt-1 text-xs text-muted-foreground">
              Provider: {{ providerFor(modelEntry).providerLabel }}
              <span class="font-mono"
                >({{ providerFor(modelEntry).providerId }})</span
              >
            </p>
            <div class="mt-2 flex items-center gap-2">
              <Badge
                :variant="
                  statusFor(modelEntry) === 'Skipped' ? 'warning' : 'secondary'
                "
                >{{ statusFor(modelEntry) }}</Badge
              ><span class="text-xs text-muted-foreground"
                >{{ accountsFor(modelEntry).length }} active account{{
                  accountsFor(modelEntry).length === 1 ? "" : "s"
                }}</span
              >
            </div>
          </div>
          <div class="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" @click="selectAll(modelEntry)"
              ><Check class="size-3.5" />All accounts</Button
            ><Button
              variant="ghost"
              size="sm"
              class="text-warning"
              @click="skip(modelEntry)"
              ><SkipForward class="size-3.5" />Skip</Button
            >
          </div>
        </div>
        <div class="mx-5 my-4 overflow-hidden rounded-lg border">
          <div
            v-if="!accountsFor(modelEntry).length"
            class="p-4 text-sm text-muted-foreground"
          >
            No active accounts are configured for
            <code>{{ providerFor(modelEntry).providerId }}</code
            >.
          </div>
          <template v-else>
            <div
              v-for="group in groupConnections(orderedAccounts(modelEntry))"
              :key="group.name"
            >
              <div
                v-if="hasNamedGroups(modelEntry)"
                class="flex cursor-pointer select-none items-center gap-2 border-b bg-muted/30 px-3 py-2 hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  class="size-3.5 accent-primary"
                  :checked="
                    groupIsChecked(
                      modelEntry,
                      group.connections.map((connection) => connection.id),
                    )
                  "
                  :disabled="groupIsDynamic(modelEntry, group.name)"
                  :indeterminate="
                    groupIsIndeterminate(
                      modelEntry,
                      group.connections.map((connection) => connection.id),
                    )
                  "
                  @change="
                    toggleGroup(
                      modelEntry,
                      group.connections.map((connection) => connection.id),
                    )
                  "
                /><FolderX
                  v-if="group.name === 'Ungrouped'"
                  class="size-4 text-muted-foreground"
                /><Folder v-else class="size-4 text-muted-foreground" /><span
                  class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                  >{{ group.name }}</span
                ><span class="text-xs text-muted-foreground"
                  >({{
                    groupSelectedCount(
                      modelEntry,
                      group.connections.map((connection) => connection.id),
                    )
                  }}/{{ group.connections.length }})</span
                ><label
                  v-if="group.name !== 'Ungrouped'"
                  class="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
                  ><input
                    type="checkbox"
                    class="size-3.5 accent-primary"
                    :checked="groupIsDynamic(modelEntry, group.name)"
                    @change="
                      toggleDynamicGroup(
                        modelEntry,
                        group.name,
                        group.connections.map((connection) => connection.id),
                      )
                    "
                  />Follow group</label
                >
              </div>
              <label
                v-for="connection in group.connections"
                :key="connection.id"
                class="flex cursor-pointer items-center justify-between gap-3 border-b px-3 py-3 last:border-b-0 hover:bg-muted/25"
                :class="
                  groupIsDynamic(modelEntry, group.name)
                    ? 'cursor-not-allowed opacity-60'
                    : ''
                "
                ><div class="flex min-w-0 items-center gap-3">
                  <span
                    v-if="
                      useCustomOrder &&
                      selectedIds(modelEntry).includes(connection.id)
                    "
                    class="w-4 text-center text-[11px] font-semibold text-primary"
                    >{{
                      selectedIds(modelEntry).indexOf(connection.id) + 1
                    }}</span
                  ><span v-else class="w-4" />
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                      {{ connection.name || connection.email || connection.id }}
                    </p>
                    <p class="truncate text-xs text-muted-foreground">
                      {{
                        connection.email &&
                        connection.email !==
                          (connection.name || connection.email)
                          ? `${connection.email} · `
                          : ""
                      }}Priority {{ connection.priority }} ·
                      {{ connection.authType }}
                    </p>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-1" @click.stop>
                  <template
                    v-if="
                      useCustomOrder &&
                      selectedIds(modelEntry).includes(connection.id)
                    "
                    ><Button
                      variant="ghost"
                      size="icon"
                      :disabled="
                        groupIsDynamic(modelEntry, group.name) ||
                        selectedIds(modelEntry).indexOf(connection.id) === 0
                      "
                      aria-label="Move account up"
                      @click="
                        moveAccount(
                          modelEntry,
                          selectedIds(modelEntry).indexOf(connection.id),
                          -1,
                        )
                      "
                      ><ArrowUp class="size-3.5" /></Button
                    ><Button
                      variant="ghost"
                      size="icon"
                      :disabled="
                        groupIsDynamic(modelEntry, group.name) ||
                        selectedIds(modelEntry).indexOf(connection.id) ===
                          selectedIds(modelEntry).length - 1
                      "
                      aria-label="Move account down"
                      @click="
                        moveAccount(
                          modelEntry,
                          selectedIds(modelEntry).indexOf(connection.id),
                          1,
                        )
                      "
                      ><ArrowDown class="size-3.5" /></Button></template
                  ><input
                    type="checkbox"
                    class="size-4 accent-primary"
                    :checked="selectedIds(modelEntry).includes(connection.id)"
                    :disabled="groupIsDynamic(modelEntry, group.name)"
                    @change="toggleAccount(modelEntry, connection.id)"
                  /></div
              ></label>
            </div>
          </template>
        </div>
      </Card>
    </div>
  </div>
</template>
