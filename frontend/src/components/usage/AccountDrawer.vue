<script setup lang="ts">
import { ref, watch } from "vue";
import { X } from "lucide-vue-next";
import { api } from "@/lib/api";
import { currency, date, displayName, number } from "@/lib/format";
import Button from "@/components/ui/button.vue";
import Card from "@/components/ui/card.vue";

interface ModelRow {
  rawModel?: string;
  provider?: string;
  requests?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cost?: number;
  lastUsed?: string;
}

interface RequestRow {
  timestamp?: string;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  status?: string;
  clientIp?: string | null;
}

interface AccountStats {
  totalRequests?: number;
  totalTokens?: number;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalCachedTokens?: number;
  totalCost?: number;
  uniqueIps?: number;
  lastUsed?: string | null;
  highlights?: {
    mostRequestedModel?: {
      model?: string;
      requests?: number;
      totalTokens?: number;
    } | null;
    mostTokensModel?: {
      model?: string;
      requests?: number;
      totalTokens?: number;
    } | null;
  };
  byModel?: ModelRow[];
  recentRequests?: RequestRow[];
}

const props = defineProps<{
  open: boolean;
  connectionId: string | null;
  connectionLabel: string;
}>();
const emit = defineEmits<{ close: [] }>();

const loading = ref(false);
const detail = ref<AccountStats>({});

function relative(value: string | null | undefined) {
  if (!value) return "Never";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  return seconds < 60
    ? seconds
      ? `${seconds}s ago`
      : "Just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
}

async function load() {
  if (!props.open || !props.connectionId) return;
  loading.value = true;
  try {
    detail.value = (await api.usage.accountDetail(
      props.connectionId,
      "all",
    )) as AccountStats;
  } catch {
    detail.value = {};
  } finally {
    loading.value = false;
  }
}

watch(
  [() => props.open, () => props.connectionId],
  () => {
    detail.value = {};
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <Transition name="usage-drawer">
    <div
      v-if="props.open"
      class="fixed inset-0 z-50 flex justify-end bg-black/45"
      @click.self="emit('close')"
    >
      <aside
        class="h-full w-full max-w-3xl overflow-y-auto bg-background p-5 shadow-2xl sm:p-6"
      >
        <div class="flex items-start justify-between gap-4 border-b pb-4">
          <div class="min-w-0">
            <h2 class="break-words text-lg font-semibold">
              {{ props.connectionLabel || "Account" }}
            </h2>
            <p class="mt-1 text-xs text-muted-foreground">Period: All Time</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            title="Close details"
            aria-label="Close details"
            @click="emit('close')"
            ><X class="size-4"
          /></Button>
        </div>
        <div
          v-if="loading"
          class="py-16 text-center text-sm text-muted-foreground"
        >
          Loading usage...
        </div>
        <template v-else-if="!detail.totalRequests">
          <div
            class="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground"
          >
            <span class="material-symbols-outlined text-[28px]">bar_chart</span>
            <p>No usage recorded for this account.</p>
          </div>
        </template>
        <div v-else class="mt-5 space-y-6">
          <!-- Summary -->
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card class="p-3"
              ><p
                class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Requests
              </p>
              <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                {{ number(detail.totalRequests) }}
              </p></Card
            >
            <Card class="p-3"
              ><p
                class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Total tokens
              </p>
              <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                {{ number(detail.totalTokens) }}
              </p></Card
            >
            <Card class="p-3"
              ><p
                class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Input
              </p>
              <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                {{ number(detail.totalPromptTokens) }}
              </p></Card
            >
            <Card class="p-3"
              ><p
                class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Output
              </p>
              <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                {{ number(detail.totalCompletionTokens) }}
              </p></Card
            >
            <Card class="p-3"
              ><p
                class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Cached
              </p>
              <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                {{ number(detail.totalCachedTokens) }}
              </p></Card
            >
            <Card class="p-3"
              ><p
                class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Cost
              </p>
              <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                {{ currency(detail.totalCost) }}
              </p></Card
            >
          </div>
          <div
            class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground"
          >
            <span
              ><span class="font-medium text-foreground">Unique IPs:</span>
              {{ number(detail.uniqueIps) }}</span
            >
            <span
              ><span class="font-medium text-foreground">Last used:</span>
              {{ detail.lastUsed ? relative(detail.lastUsed) : "Never" }}</span
            >
          </div>

          <!-- Highlights -->
          <div
            v-if="
              detail.highlights?.mostRequestedModel ||
              detail.highlights?.mostTokensModel
            "
            class="grid gap-3 sm:grid-cols-2"
          >
            <Card v-if="detail.highlights?.mostRequestedModel" class="p-3">
              <p
                class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Most requested model
              </p>
              <p
                class="mt-1 truncate text-sm font-medium"
                :title="detail.highlights.mostRequestedModel.model || ''"
              >
                {{ detail.highlights.mostRequestedModel.model || "—" }}
              </p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                {{ number(detail.highlights.mostRequestedModel.requests) }}
                requests ·
                {{ number(detail.highlights.mostRequestedModel.totalTokens) }}
                tokens
              </p>
            </Card>
            <Card v-if="detail.highlights?.mostTokensModel" class="p-3">
              <p
                class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Most tokens model
              </p>
              <p
                class="mt-1 truncate text-sm font-medium"
                :title="detail.highlights.mostTokensModel.model || ''"
              >
                {{ detail.highlights.mostTokensModel.model || "—" }}
              </p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                {{ number(detail.highlights.mostTokensModel.totalTokens) }}
                tokens ·
                {{ number(detail.highlights.mostTokensModel.requests) }}
                requests
              </p>
            </Card>
          </div>

          <!-- Models -->
          <section v-if="detail.byModel?.length">
            <h3
              class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Models
            </h3>
            <div class="overflow-x-auto rounded-lg border">
              <table class="w-full min-w-[560px] text-left text-xs">
                <thead
                  class="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  <tr>
                    <th class="font-semibold px-3 py-2">Model</th>
                    <th class="font-semibold px-3 py-2 text-right">Requests</th>
                    <th class="font-semibold px-3 py-2 text-right">Input</th>
                    <th class="font-semibold px-3 py-2 text-right">Output</th>
                    <th class="font-semibold px-3 py-2 text-right">Cached</th>
                    <th class="font-semibold px-3 py-2 text-right">Cost</th>
                    <th class="font-semibold px-3 py-2 text-right">
                      Last used
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  <tr
                    v-for="(row, index) in detail.byModel"
                    :key="`${row.rawModel}-${index}`"
                    class="hover:bg-muted/30"
                  >
                    <td class="max-w-[220px] px-2.25 py-1.5">
                      <span
                        class="block truncate font-mono"
                        :title="row.rawModel || ''"
                        >{{ row.rawModel || "—" }}</span
                      ><span
                        v-if="row.provider"
                        class="block text-[10px] text-muted-foreground"
                        >{{ displayName(row.provider) }}</span
                      >
                    </td>
                    <td
                      class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                    >
                      {{ number(row.requests) }}
                    </td>
                    <td
                      class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                    >
                      {{ number(row.promptTokens) }}
                    </td>
                    <td
                      class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                    >
                      {{ number(row.completionTokens) }}
                    </td>
                    <td
                      class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                    >
                      {{ number(row.cachedTokens || 0) }}
                    </td>
                    <td
                      class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                    >
                      {{ currency(row.cost) }}
                    </td>
                    <td class="px-2.25 py-1.5 text-right text-muted-foreground">
                      {{ row.lastUsed ? relative(row.lastUsed) : "—" }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Request logs -->
          <section v-if="detail.recentRequests?.length">
            <h3
              class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Recent requests
            </h3>
            <div class="overflow-x-auto rounded-lg border">
              <table class="w-full min-w-[560px] text-left text-xs">
                <thead
                  class="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  <tr>
                    <th class="font-semibold px-3 py-2">Time</th>
                    <th class="font-semibold px-3 py-2">Model</th>
                    <th class="font-semibold px-3 py-2 text-right">Input</th>
                    <th class="font-semibold px-3 py-2 text-right">Output</th>
                    <th class="font-semibold px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  <tr
                    v-for="(row, index) in detail.recentRequests"
                    :key="`request-${row.timestamp}-${index}`"
                    class="hover:bg-muted/30"
                  >
                    <td
                      class="px-2.25 py-1.5 text-muted-foreground"
                      :title="row.timestamp ? date(row.timestamp) : ''"
                    >
                      {{ row.timestamp ? relative(row.timestamp) : "—" }}
                    </td>
                    <td class="max-w-[220px] px-2.25 py-1.5">
                      <span
                        class="block truncate font-mono"
                        :title="String(row.model || '')"
                        >{{ row.model || "—" }}</span
                      ><span
                        v-if="row.provider"
                        class="block text-[10px] text-muted-foreground"
                        >{{ displayName(row.provider) }}</span
                      >
                    </td>
                    <td
                      class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                    >
                      {{ number(row.promptTokens) }}
                    </td>
                    <td
                      class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                    >
                      {{ number(row.completionTokens) }}
                    </td>
                    <td class="px-2.25 py-1.5 text-right font-mono">
                      {{ row.status || "ok" }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.usage-drawer-enter-active,
.usage-drawer-leave-active {
  transition: opacity 180ms ease;
}
.usage-drawer-enter-from,
.usage-drawer-leave-to {
  opacity: 0;
}
.usage-drawer-enter-active aside,
.usage-drawer-leave-active aside {
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.usage-drawer-enter-from aside,
.usage-drawer-leave-to aside {
  transform: translateX(100%);
}
</style>
