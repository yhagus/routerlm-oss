<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ArrowLeft, Copy, ExternalLink } from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import { number } from "@/lib/format";
import type { ApiKey } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import Input from "@/components/ui/input.vue";
import Toggle from "@/components/ui/toggle.vue";
import TableSkeleton from "@/components/ui/table-skeleton.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import { useNotificationStore } from "@/stores/notifications";

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const notices = useNotificationStore();
const id = computed(() => String(route.params.id || ""));

const event = useQuery({
  queryKey: ["api-key", id],
  queryFn: async () => (await api.keys.get(id.value)).key,
});
const isEvent = computed(
  () => event.data.value?.visibility === "event" && !event.data.value.parentId,
);
const publicLink = computed(
  () => `${window.location.origin}/event/${encodeURIComponent(id.value)}`,
);

const searchInput = ref("");
const search = ref("");
const page = ref(1);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    search.value = value.trim();
    page.value = 1;
  }, 250);
});

const participants = useQuery({
  queryKey: computed(() => ["api-key-children", id.value, page.value, search.value]),
  queryFn: () =>
    api.keys.children(id.value, {
      page: page.value,
      pageSize: 20,
      search: search.value || undefined,
    }),
  enabled: isEvent,
  placeholderData: keepPreviousData,
  refetchInterval: 10_000,
});
const rows = computed(() => participants.data.value?.keys || []);
const pagination = computed(() => participants.data.value?.pagination);

function policyLabel(key: ApiKey | undefined): string {
  if (!key) return "";
  const parts = [
    `Combos: ${key.comboAccessMode === "whitelist" ? "whitelist" : "blacklist"} (${key.comboAccessList?.length || 0})`,
    `Models: ${key.modelAccessMode === "blacklist" ? "blacklist" : "whitelist"} (${key.modelAccessList?.length || 0})`,
  ];
  if (key.limitMode && key.limitMode !== "none" && Number(key.limitValue) > 0) {
    parts.push(`Limit: ${number(Number(key.limitValue))} ${key.limitMode} per key`);
  }
  if (Number(key.maxConcurrency) > 0) {
    parts.push(`Max ${key.maxConcurrency} concurrent per key`);
  }
  return parts.join(" · ");
}

function dateLabel(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

const skeletonColumns = [
  { width: "40%", lines: 2 as const },
  { width: "15%", align: "end" as const },
  { width: "15%", align: "end" as const },
  { width: "20%" },
  { width: "10%", align: "end" as const },
];

function openPublicLink() {
  window.open(publicLink.value, "_blank", "noopener");
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(publicLink.value);
    notices.push("success", "Event link copied.");
  } catch {
    notices.push("error", "Could not copy to clipboard.");
  }
}

function refresh() {
  void queryClient.invalidateQueries({ queryKey: ["api-key-children", id.value] });
}

async function toggleEvent(value: boolean) {
  try {
    await api.keys.update(id.value, { isActive: value });
    await queryClient.invalidateQueries({ queryKey: ["api-key", id] });
  } catch (error) {
    notices.push("error", error instanceof Error ? error.message : "Could not update event.");
  }
}

async function toggleParticipant(key: ApiKey, value: boolean) {
  try {
    await api.keys.update(key.id, { isActive: value });
    refresh();
  } catch (error) {
    notices.push("error", error instanceof Error ? error.message : "Could not update key.");
  }
}

async function openStats(key: ApiKey) {
  try {
    const { key: secret } = await api.keys.reveal(key.id);
    window.open(`/?apikey=${encodeURIComponent(secret)}`, "_blank", "noopener");
  } catch (error) {
    notices.push("error", error instanceof Error ? error.message : "Could not open usage stats.");
  }
}

const pendingDelete = ref<ApiKey | null>(null);
const deleting = ref(false);
async function confirmDelete() {
  if (!pendingDelete.value) return;
  deleting.value = true;
  try {
    await api.keys.remove(pendingDelete.value.id);
    pendingDelete.value = null;
    refresh();
  } catch (error) {
    notices.push("error", error instanceof Error ? error.message : "Could not delete key.");
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div v-if="event.isPending.value" class="space-y-6">
    <div class="h-16 animate-pulse rounded-xl bg-muted" />
    <div class="h-64 animate-pulse rounded-xl bg-muted" />
  </div>
  <div v-else-if="!isEvent" class="space-y-6">
    <PageHeader
      title="Event"
      description="The requested event could not be loaded."
    /><EmptyState
      title="Event not found"
      description="This event may have been removed or the route id is invalid."
      ><Button @click="router.push('/dashboard/endpoint')"
        ><ArrowLeft class="size-4" />Back to keys</Button
      ></EmptyState
    >
  </div>
  <div v-else class="space-y-6">
    <PageHeader
      :title="event.data.value?.name || 'Event'"
      description="Visitors of the event link create their own API keys. Each key inherits this event's configuration."
    >
      <template #actions
        ><Button
          variant="outline"
          size="sm"
          @click="router.push('/dashboard/endpoint')"
          ><ArrowLeft class="size-4" />Keys</Button
        ></template
      >
    </PageHeader>

    <Card class="flex flex-col gap-4 p-5">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-medium">Public link</p>
          <p class="mt-1 text-xs text-muted-foreground">
            Anyone with this link can create a key. Pause the event to stop new
            keys and disable every participant key.
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Badge :variant="event.data.value?.isActive ? 'success' : 'warning'">{{
            event.data.value?.isActive ? "Active" : "Paused"
          }}</Badge>
          <Toggle
            size="sm"
            :checked="event.data.value?.isActive !== false"
            :title="event.data.value?.isActive ? 'Pause event' : 'Resume event'"
            @change="toggleEvent"
          />
        </div>
      </div>
      <div class="flex gap-2">
        <Input :model-value="publicLink" readonly class="flex-1 font-mono text-sm" />
        <Button variant="outline" size="icon" aria-label="Copy event link" title="Copy event link" @click="copyLink"
          ><Copy class="size-4"
        /></Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Open event page"
          title="Open event page"
          @click="openPublicLink"
          ><ExternalLink class="size-4"
        /></Button>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ policyLabel(event.data.value) }}. Edit the policy from the key list
        actions.
      </p>
    </Card>

    <Card class="flex flex-col gap-3 p-5">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm font-medium">
          Participants
          <span class="text-muted-foreground">({{ number(pagination?.totalItems || 0) }})</span>
        </p>
        <Input v-model="searchInput" placeholder="Search by name..." class="sm:max-w-xs" />
      </div>
      <TableSkeleton
        v-if="participants.isPending.value"
        :columns="skeletonColumns"
      />
      <p v-else-if="!rows.length" class="py-8 text-center text-sm text-muted-foreground">
        {{ search ? "No participant matches this search." : "No participants yet. Share the event link." }}
      </p>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[560px] text-sm">
          <thead>
            <tr class="border-b text-left text-xs text-muted-foreground">
              <th class="px-3 py-2 font-medium">Name</th>
              <th class="px-3 py-2 text-right font-medium">Tokens</th>
              <th class="px-3 py-2 text-right font-medium">Requests</th>
              <th class="px-3 py-2 font-medium">Last used</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="key in rows"
              :key="key.id"
              class="border-b border-border/60 last:border-b-0 hover:bg-muted/50"
              :class="key.isActive === false ? 'opacity-60' : ''"
            >
              <td class="px-3 py-2">
                <div class="font-medium">{{ key.name }}</div>
                <div class="text-[10px] text-muted-foreground">
                  {{ key.keyPrefix }} · {{ dateLabel(key.createdAt) }}
                </div>
              </td>
              <td class="px-3 py-2 text-right font-mono">
                {{ number(key.usage?.totalTokens || 0) }}
              </td>
              <td class="px-3 py-2 text-right font-mono">
                {{ number(key.usage?.requests || 0) }}
              </td>
              <td class="px-3 py-2 text-xs text-muted-foreground">
                {{ dateLabel(key.usage?.lastUsed) }}
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center justify-end gap-1">
                  <Toggle
                    size="sm"
                    :checked="key.isActive !== false"
                    :title="key.isActive !== false ? 'Pause key' : 'Resume key'"
                    @change="(value: boolean) => toggleParticipant(key, value)"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Open usage stats"
                    title="Open usage stats in a new tab"
                    @click="openStats(key)"
                    ><span class="material-symbols-outlined text-[16px]">open_in_new</span></Button
                  >
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete key"
                    title="Delete key"
                    @click="pendingDelete = key"
                    ><span class="material-symbols-outlined text-[16px] text-destructive">delete</span></Button
                  >
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="pagination && pagination.totalPages > 1"
        class="flex items-center justify-end gap-2 text-xs text-muted-foreground"
      >
        <Button variant="outline" size="sm" :disabled="page <= 1" @click="page -= 1">Previous</Button>
        <span>Page {{ pagination.page }} / {{ pagination.totalPages }}</span>
        <Button
          variant="outline"
          size="sm"
          :disabled="page >= pagination.totalPages"
          @click="page += 1"
          >Next</Button
        >
      </div>
    </Card>

    <ConfirmModal
      :open="Boolean(pendingDelete)"
      title="Delete participant key"
      :message="`Delete the key of ${pendingDelete?.name}? The key stops working immediately.`"
      :loading="deleting"
      @close="pendingDelete = null"
      @confirm="confirmDelete"
    />
  </div>
</template>
