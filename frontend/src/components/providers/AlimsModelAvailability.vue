<script setup lang="ts">
// Alibaba Studio (alims-intl) free-tier availability.
//
// Model Studio grants a per-model free quota per account. When an account has
// spent it, the model returns HTTP 403 with code AllocationQuota.FreeTierOnly;
// the backend marks that model exhausted for the account. This card renders the
// same model list as "Available Models" as a compact grid and shows, per model,
// how many accounts can still serve it (available-account progress bar).
import { computed, onMounted, ref } from "vue";
import { api } from "@/lib/api";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";

interface ModelRow {
  id: string;
  total: number;
  exhausted: number;
  available: number;
  percent: number;
}

const props = defineProps<{
  providerId: string;
  models: Array<{ id: string; name?: string }>;
}>();

const loading = ref(true);
const refreshing = ref(false);
const resetting = ref(false);
const error = ref("");
const totalAccounts = ref(0);
const exhaustedByModel = ref<Map<string, number>>(new Map());

// One tile per model in the "Available Models" list. A model with no recorded
// exhaustion is fully available. Provider-reported models that are not in the
// list are ignored so both surfaces stay in sync.
const rows = computed<ModelRow[]>(() =>
  props.models.map((model) => {
    const exhausted = exhaustedByModel.value.get(model.id) ?? 0;
    const total = totalAccounts.value;
    const available = Math.max(0, total - exhausted);
    return {
      id: model.id,
      total,
      exhausted,
      available,
      percent: total > 0 ? Math.round((available / total) * 100) : 0,
    };
  }),
);

const exhaustedTotal = computed(() =>
  rows.value.reduce((sum, model) => sum + model.exhausted, 0),
);

function barTone(percent: number) {
  if (percent <= 0) return "bg-destructive";
  if (percent < 100) return "bg-warning";
  return "bg-success";
}

async function load(refresh = false) {
  if (refresh) refreshing.value = true;
  else loading.value = true;
  error.value = "";
  try {
    const data = await api.providers.alimsModelAvailability();
    totalAccounts.value = data.totalAccounts;
    exhaustedByModel.value = new Map(
      data.models.map((model) => [model.id, model.exhausted]),
    );
  } catch (reason) {
    error.value =
      reason instanceof Error ? reason.message : "Failed to load availability";
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function reset() {
  resetting.value = true;
  try {
    await api.providers.resetAlimsModelAvailability();
    await load(true);
  } catch (reason) {
    error.value =
      reason instanceof Error ? reason.message : "Failed to reset availability";
  } finally {
    resetting.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <Card v-if="props.providerId === 'alims-intl'" class="p-4 sm:col-span-2">
    <div class="mb-3 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">Free-tier availability</h2>
        <p class="text-xs text-muted-foreground">
          {{ totalAccounts }} account(s) · available per model
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          :disabled="loading || refreshing"
          title="Refresh availability"
          @click="load(true)"
        >
          <span
            class="material-symbols-outlined text-sm"
            :class="{ 'animate-spin': refreshing }"
            >refresh</span
          >
          Refresh
        </Button>
        <Button
          v-if="exhaustedTotal > 0"
          size="sm"
          variant="ghost"
          :disabled="loading || resetting"
          title="Reset exhausted accounts"
          @click="reset"
        >
          <span class="material-symbols-outlined text-sm">restart_alt</span>
        </Button>
      </div>
    </div>

    <p v-if="error" class="mb-3 break-words text-xs text-red-500">{{ error }}</p>
    <p v-else-if="loading" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="!rows.length" class="text-sm text-muted-foreground">
      No models available.
    </p>

    <div v-else class="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      <div
        v-for="model in rows"
        :key="model.id"
        class="rounded-md border border-border/60 px-2 py-1.5"
      >
        <div class="flex items-center justify-between gap-1">
          <span class="truncate font-mono text-[10px]" :title="model.id">{{
            model.id
          }}</span>
          <span class="shrink-0 text-[10px] font-medium tabular-nums"
            >{{ model.percent }}%</span
          >
        </div>
        <div class="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full transition-all duration-300"
            :class="barTone(model.percent)"
            :style="{ width: `${model.percent}%` }"
          />
        </div>
        <div
          class="mt-0.5 flex items-center justify-between text-[9px] tabular-nums text-muted-foreground"
        >
          <span>{{ model.available }}/{{ model.total }}</span>
          <span v-if="model.exhausted > 0" class="font-medium text-destructive"
            >{{ model.exhausted }} exhausted</span
          >
        </div>
      </div>
    </div>
  </Card>
</template>
