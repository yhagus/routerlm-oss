<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { Search } from "lucide-vue-next";
import { api } from "@/lib/api";
import { compact, currency, number } from "@/lib/format";
import Button from "@/components/ui/button.vue";
import Select from "@/components/ui/select.vue";
import TableSkeleton from "@/components/ui/table-skeleton.vue";
import type { UsagePeriod } from "@/types/api";

const props = defineProps<{ period: UsagePeriod; refreshKey?: number }>();

const page = ref(1);
const pageSize = ref(10);
const searchInput = ref("");
const search = ref("");
let timer: number | undefined;
const pageSizeOptions = [10, 25, 50].map((value) => ({
  value,
  label: `${value} / page`,
}));

const models = useQuery({
  queryKey: [
    "usage",
    "overview-models",
    computed(() => props.period),
    page,
    pageSize,
    search,
    computed(() => props.refreshKey),
  ],
  queryFn: () =>
    api.usage.models(props.period, page.value, pageSize.value, search.value),
  // Keep the old rows on screen while the next page loads.
  placeholderData: (previous) => previous,
});

const rows = computed(() => models.data.value?.items || []);
const pagination = computed(() => models.data.value?.pagination);
const totalPages = computed(() => pagination.value?.totalPages || 1);

function changeSearch(event: Event) {
  searchInput.value = (event.target as HTMLInputElement).value;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    search.value = searchInput.value;
    page.value = 1;
  }, 300);
}
watch(
  () => props.period,
  () => {
    page.value = 1;
  },
);
watch(pageSize, () => {
  page.value = 1;
});
onUnmounted(() => {
  if (timer) window.clearTimeout(timer);
});
</script>

<template>
  <section class="overflow-hidden rounded-[10px] border bg-card">
    <div
      class="flex flex-col gap-3 px-5 pb-3 pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="min-w-0">
        <h2 class="text-base font-semibold">Usage by model</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{ number(pagination?.totalItems ?? 0) }} models, ranked by requests.
        </p>
      </div>
      <div class="relative w-full sm:w-64">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          :value="searchInput"
          class="h-9 w-full min-w-0 rounded-md border border-input bg-background pl-9 pr-3 text-sm"
          placeholder="Search models..."
          aria-label="Search models"
          @input="changeSearch"
        />
      </div>
    </div>

    <div v-if="models.isPending.value" class="px-5 pb-5">
      <TableSkeleton
        :columns="[
          { width: '34%' },
          { width: '14%', align: 'end' },
          { width: '16%', align: 'end' },
          { width: '16%', align: 'end' },
          { width: '14%', align: 'end' },
        ]"
        :rows="5"
        label="Loading models"
      />
    </div>
    <p
      v-else-if="!rows.length"
      class="border-t px-5 py-8 text-center text-sm text-muted-foreground"
    >
      {{
        search
          ? "No models match your search."
          : "No model usage in this period."
      }}
    </p>
    <div
      v-else
      class="overflow-x-auto border-t transition-opacity"
      :class="models.isFetching.value ? 'opacity-60' : ''"
    >
      <table class="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr class="border-b bg-muted/60 text-muted-foreground">
            <th class="px-5 py-2.5 font-semibold">Model</th>
            <th class="px-5 py-2.5 text-right font-semibold">Requests</th>
            <th class="px-5 py-2.5 text-right font-semibold">Input tokens</th>
            <th class="px-5 py-2.5 text-right font-semibold">Output tokens</th>
            <th class="px-5 py-2.5 text-right font-semibold">Estimated cost</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/60">
          <tr v-for="row in rows" :key="row.id" class="hover:bg-muted/50">
            <td class="max-w-[320px] px-3.75 py-[7.5px] font-mono">
              <span class="block truncate" :title="row.name">{{
                row.name
              }}</span>
            </td>
            <td class="px-3.75 py-[7.5px] text-right font-mono tabular-nums">
              {{ number(row.usage.requests) }}
            </td>
            <td class="px-3.75 py-[7.5px] text-right font-mono tabular-nums">
              {{ compact(row.usage.promptTokens) }}
            </td>
            <td class="px-3.75 py-[7.5px] text-right font-mono tabular-nums">
              {{ compact(row.usage.completionTokens) }}
            </td>
            <td class="px-3.75 py-[7.5px] text-right font-mono tabular-nums">
              {{ currency(row.usage.cost) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="pagination && pagination.totalItems > 0"
      class="flex flex-col gap-3 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <span class="text-xs text-muted-foreground tabular-nums"
        >Page {{ page }} of {{ totalPages }}</span
      >
      <div class="flex flex-wrap items-center gap-2">
        <Select
          v-model="pageSize"
          :options="pageSizeOptions"
          class="w-auto min-w-28"
          aria-label="Models per page"
        />
        <Button variant="outline" :disabled="page <= 1" @click="page--"
          >Previous</Button
        >
        <Button variant="outline" :disabled="page >= totalPages" @click="page++"
          >Next</Button
        >
      </div>
    </div>
  </section>
</template>
