<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  Check,
  Folder,
  FolderOpen,
  FolderX,
  RefreshCw,
  Users,
  X,
} from "lucide-vue-next";
import { useRouter } from "vue-router";
import { api } from "@/lib/api";
import {
  connectionGroup,
  connectionLabel,
  connectionSecondaryLabel,
  groupConnections,
  providerLabel,
  withConnectionGroup,
} from "@/lib/routing";
import type { ProviderConnection } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Combobox from "@/components/ui/combobox.vue";
import Input from "@/components/ui/input.vue";
import Badge from "@/components/ui/badge.vue";
import ProviderLogo from "@/components/app/ProviderLogo.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import { useNotificationStore } from "@/stores/notifications";

const router = useRouter();
const queryClient = useQueryClient();
const notices = useNotificationStore();
const providers = useQuery({
  queryKey: ["providers"],
  queryFn: api.providers.list,
});
const nodes = useQuery({
  queryKey: ["provider-nodes"],
  queryFn: api.nodes.list,
});
const search = ref("");
const activeProvider = ref("");
const selectedIds = ref<string[]>([]);
const busy = ref(false);
const bulkGroup = ref("");
const customGroupConnection = ref<string | null>(null);
const customGroup = ref("");
const renameTarget = ref<string | null>(null);
const renameValue = ref("");
const ungroupTarget = ref<{
  targets: ProviderConnection[];
  groupName: string;
} | null>(null);

const providerEntries = computed(() => {
  const map = new Map<string, ProviderConnection[]>();
  for (const connection of providers.data.value || [])
    map.set(connection.provider, [
      ...(map.get(connection.provider) || []),
      connection,
    ]);
  return [...map.entries()]
    .map(([providerId, connections]) => ({
      providerId,
      label: providerLabel(providerId, nodes.data.value || []),
      connections,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

const filteredProviders = computed(() => {
  const value = search.value.trim().toLowerCase();
  return value
    ? providerEntries.value.filter((entry) =>
        `${entry.label} ${entry.providerId}`.toLowerCase().includes(value),
      )
    : providerEntries.value;
});

watch(
  providerEntries,
  (entries) => {
    if (!entries.some((entry) => entry.providerId === activeProvider.value))
      activeProvider.value = entries[0]?.providerId || "";
  },
  { immediate: true },
);
watch(activeProvider, () => {
  selectedIds.value = [];
  customGroupConnection.value = null;
  renameTarget.value = null;
});

const activeEntry = computed(
  () =>
    providerEntries.value.find(
      (entry) => entry.providerId === activeProvider.value,
    ) || null,
);
const activeConnections = computed(() => activeEntry.value?.connections || []);
const activeGroups = computed(() => groupConnections(activeConnections.value));
const groupOptions = computed(() =>
  activeGroups.value
    .map((group) => group.name)
    .filter((name) => name !== "Ungrouped"),
);
const groupSelectOptions = computed(() => [
  { value: "__ungrouped__", label: "Ungrouped" },
  ...groupOptions.value.map((group) => ({ value: group, label: group })),
  { value: "__new__", label: "+ New group" },
]);
const selectedConnections = computed(() =>
  activeConnections.value.filter((connection) =>
    selectedIds.value.includes(connection.id),
  ),
);
const allSelected = computed(
  () =>
    activeConnections.value.length > 0 &&
    selectedIds.value.length === activeConnections.value.length,
);

function selectAll() {
  selectedIds.value = allSelected.value
    ? []
    : activeConnections.value.map((connection) => connection.id);
}

async function applyGroup(targets: ProviderConnection[], group: string) {
  if (!targets.length) return;
  busy.value = true;
  try {
    const results = await Promise.allSettled(
      targets.map((connection) =>
        api.providers.update(connection.id, {
          data: withConnectionGroup(connection, group),
        }),
      ),
    );
    const failed = results.filter(
      (result) => result.status === "rejected",
    ).length;
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
    selectedIds.value = [];
    if (failed)
      notices.push(
        "error",
        `${failed} account update${failed === 1 ? "" : "s"} failed.`,
      );
    else
      notices.push(
        "success",
        `${targets.length} account${targets.length === 1 ? "" : "s"} moved to ${group || "Ungrouped"}.`,
      );
  } finally {
    busy.value = false;
  }
}

function assign(connection: ProviderConnection, value: string) {
  if (value === "__new__") {
    customGroupConnection.value = connection.id;
    customGroup.value = "";
    return;
  }
  if (value === "__ungrouped__") {
    requestUngroup(
      [connection],
      connectionGroup(connection) || "their current group",
    );
    return;
  }
  applyGroup([connection], value);
}

function assignFromEvent(
  connection: ProviderConnection,
  value: string | number,
) {
  assign(connection, String(value));
}

function submitCustomGroup(connection: ProviderConnection) {
  const value = customGroup.value.trim();
  if (value) applyGroup([connection], value);
  customGroupConnection.value = null;
}

function moveSelected() {
  const value = bulkGroup.value.trim();
  if (value) applyGroup(selectedConnections.value, value);
  bulkGroup.value = "";
}

function requestUngroup(targets: ProviderConnection[], groupName: string) {
  if (!targets.length) return;
  ungroupTarget.value = { targets, groupName };
}

async function confirmUngroup() {
  const target = ungroupTarget.value;
  if (!target) return;
  ungroupTarget.value = null;
  await applyGroup(target.targets, "");
}

function beginRename(name: string) {
  renameTarget.value = name;
  renameValue.value = name;
}

function saveRename() {
  const oldName = renameTarget.value;
  const nextName = renameValue.value.trim();
  if (!oldName || !nextName || oldName === nextName || !activeEntry.value) {
    renameTarget.value = null;
    return;
  }
  applyGroup(
    activeConnections.value.filter(
      (connection) => connectionGroup(connection) === oldName,
    ),
    nextName,
  );
  renameTarget.value = null;
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Credentials"
      description="Organize real provider connections into named groups that can be selected from combo routing."
    >
      <template #actions
        ><Button variant="outline" size="sm" @click="providers.refetch()"
          ><RefreshCw class="size-4" />Refresh</Button
        ></template
      >
    </PageHeader>

    <div
      v-if="providers.isPending.value"
      class="grid gap-6 lg:grid-cols-[17rem_1fr]"
    >
      <div class="h-96 animate-pulse rounded-xl bg-muted" />
      <div class="h-96 animate-pulse rounded-xl bg-muted" />
    </div>
    <EmptyState
      v-else-if="!providerEntries.length"
      title="No provider accounts"
      description="Add provider connections first, then organize them into groups here."
      ><Button @click="router.push('/dashboard/providers/new')"
        ><Users class="size-4" />Add provider</Button
      ></EmptyState
    >
    <div v-else class="grid min-w-0 gap-6 lg:grid-cols-[17rem_1fr]">
      <Card class="overflow-hidden">
        <div class="border-b p-3">
          <Input
            v-model="search"
            placeholder="Search providers"
            aria-label="Search providers"
          />
        </div>
        <div class="max-h-[65vh] overflow-y-auto p-1.5">
          <button
            v-for="entry in filteredProviders"
            :key="entry.providerId"
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors"
            :class="
              activeProvider === entry.providerId
                ? 'bg-primary/12 text-primary'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            "
            @click="activeProvider = entry.providerId"
          >
            <ProviderLogo
              :provider="entry.providerId"
              :label="entry.label"
              size="size-7"
            /><span class="min-w-0 flex-1 truncate text-sm font-medium">{{
              entry.label
            }}</span
            ><span class="text-xs">{{ entry.connections.length }}</span>
          </button>
          <p
            v-if="!filteredProviders.length"
            class="px-3 py-6 text-center text-xs text-muted-foreground"
          >
            No providers match.
          </p>
        </div>
      </Card>

      <Card v-if="activeEntry" class="min-w-0 overflow-hidden">
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
        >
          <div class="flex items-center gap-3">
            <div
              class="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"
            >
              <FolderOpen class="size-4" />
            </div>
            <div>
              <h2 class="text-sm font-semibold">{{ activeEntry.label }}</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ activeConnections.length }} account{{
                  activeConnections.length === 1 ? "" : "s"
                }}
                · {{ groupOptions.length }} named group{{
                  groupOptions.length === 1 ? "" : "s"
                }}
              </p>
            </div>
          </div>
          <label class="flex items-center gap-2 text-xs text-muted-foreground"
            ><input
              type="checkbox"
              class="size-3.5 accent-primary"
              :checked="allSelected"
              @change="selectAll"
            />Select all</label
          >
        </div>
        <div
          v-if="selectedIds.length"
          class="flex flex-wrap items-center gap-2 border-b bg-accent/35 px-5 py-3"
        >
          <Badge>{{ selectedIds.length }} selected</Badge
          ><Input
            v-model="bulkGroup"
            class="h-8 max-w-[16rem] text-xs"
            list="account-group-options"
            placeholder="Move to group"
            :disabled="busy"
          /><datalist id="account-group-options">
            <option
              v-for="group in groupOptions"
              :key="group"
              :value="group"
            /></datalist
          ><Button
            size="sm"
            :disabled="busy || !bulkGroup.trim()"
            @click="moveSelected"
            >Move</Button
          ><Button
            variant="secondary"
            size="sm"
            :disabled="busy"
            @click="requestUngroup(selectedConnections, 'their current groups')"
            >Ungroup</Button
          ><Button
            variant="ghost"
            size="sm"
            :disabled="busy"
            @click="selectedIds = []"
            ><X class="size-3.5" />Clear</Button
          >
        </div>

        <div class="divide-y divide-border/70">
          <section v-for="group in activeGroups" :key="group.name">
            <div
              class="flex flex-wrap items-center gap-2 bg-muted/30 px-5 py-2.5"
            >
              <FolderX
                v-if="group.name === 'Ungrouped'"
                class="size-4 text-muted-foreground"
              /><Folder v-else class="size-4 text-muted-foreground" /><span
                class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >{{ group.name }}</span
              ><span class="text-xs text-muted-foreground">{{
                group.connections.length
              }}</span>
              <div
                v-if="group.name !== 'Ungrouped'"
                class="ml-auto flex items-center gap-2"
              >
                <template v-if="renameTarget === group.name"
                  ><Input
                    v-model="renameValue"
                    class="h-7 w-36 text-xs"
                    @keyup.enter="saveRename" /><Button
                    size="sm"
                    :disabled="busy || !renameValue.trim()"
                    @click="saveRename"
                    >Save</Button
                  ><Button
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel rename"
                    @click="renameTarget = null"
                    ><X class="size-3.5" /></Button></template
                ><template v-else
                  ><Button
                    variant="ghost"
                    size="sm"
                    :disabled="busy"
                    @click="beginRename(group.name)"
                    >Rename</Button
                  ><Button
                    variant="ghost"
                    size="sm"
                    :disabled="busy"
                    @click="requestUngroup(group.connections, group.name)"
                    >Ungroup</Button
                  ></template
                >
              </div>
            </div>
            <div
              v-for="connection in group.connections"
              :key="connection.id"
              class="flex flex-col gap-3 px-5 py-3.5 transition-colors hover:bg-muted/25 sm:flex-row sm:items-center"
            >
              <input
                type="checkbox"
                class="size-4 shrink-0 accent-primary"
                :checked="selectedIds.includes(connection.id)"
                :disabled="busy"
                :aria-label="`Select ${connectionLabel(connection)}`"
                @change="
                  selectedIds.includes(connection.id)
                    ? (selectedIds = selectedIds.filter(
                        (id) => id !== connection.id,
                      ))
                    : (selectedIds = [...selectedIds, connection.id])
                "
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">
                  {{ connectionLabel(connection) }}
                </p>
                <p
                  v-if="connectionSecondaryLabel(connection)"
                  class="truncate text-xs text-muted-foreground"
                >
                  {{ connectionSecondaryLabel(connection) }}
                </p>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                  <Badge
                    :variant="connection.isActive ? 'success' : 'destructive'"
                    >{{ connection.isActive ? "Active" : "Inactive" }}</Badge
                  ><span class="text-xs text-muted-foreground"
                    >Priority {{ connection.priority }} ·
                    {{ connection.authType }}</span
                  >
                </div>
              </div>
              <div class="flex w-full shrink-0 items-center gap-2 sm:w-56">
                <template v-if="customGroupConnection === connection.id"
                  ><Input
                    v-model="customGroup"
                    class="h-8 text-xs"
                    placeholder="New group name"
                    @keyup.enter="submitCustomGroup(connection)" /><Button
                    size="sm"
                    :disabled="busy || !customGroup.trim()"
                    @click="submitCustomGroup(connection)"
                    ><Check class="size-3.5" /></Button
                  ><Button
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel new group"
                    @click="customGroupConnection = null"
                    ><X class="size-3.5" /></Button></template
                ><Combobox
                  v-else
                  :model-value="connectionGroup(connection) || '__ungrouped__'"
                  :options="groupSelectOptions"
                  class="h-8 min-w-0 flex-1 text-xs"
                  :disabled="busy"
                  placeholder="Select group"
                  empty-text="No groups found"
                  :aria-label="`Group for ${connectionLabel(connection)}`"
                  @update:model-value="assignFromEvent(connection, $event)"
                />
              </div>
            </div>
          </section>
        </div>
      </Card>
    </div>
    <ConfirmModal
      :open="Boolean(ungroupTarget)"
      title="Ungroup accounts"
      :message="`Remove ${ungroupTarget?.targets.length || 0} account${ungroupTarget?.targets.length === 1 ? '' : 's'} from ${ungroupTarget?.groupName || 'their groups'}?`"
      confirm-text="Ungroup"
      :loading="busy"
      @confirm="confirmUngroup"
      @close="!busy && (ungroupTarget = null)"
    />
  </div>
</template>
