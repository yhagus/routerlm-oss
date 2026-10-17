<script setup lang="ts">
// Port of v1 QoderModelContextWindows — per-model context overrides honored
// by the qoder executor at request time.
import { onMounted, reactive, ref } from "vue";
import { api } from "@/lib/api";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";

interface QoderModelRow {
  model?: string;
  id?: string;
  provider?: string;
  caps?: { contextWindow?: number };
}

const models = ref<QoderModelRow[]>([]);
const overrides = reactive<Record<string, number>>({});
const drafts = reactive<Record<string, string>>({});
const saving = ref<string | null>(null);
const loading = ref(true);
const error = ref("");
const resetTarget = ref<string | null>(null);

function formatWindow(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${(n / 1000).toFixed(0)}k`;
}

onMounted(async () => {
  try {
    const [ctx, all] = await Promise.all([
      api.models.contextWindows("qoder"),
      api.models.list(),
    ]);
    const rows = (all as unknown as { data?: QoderModelRow[] }).data || [];
    models.value = rows.filter(
      (m) => m.provider === "qoder" || m.provider === "qd",
    );
    Object.assign(overrides, ctx.overrides || {});
    for (const [model, value] of Object.entries(ctx.overrides || {}))
      drafts[model] = String(value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
});

async function save(model: string) {
  const value = Number(drafts[model]);
  if (!Number.isFinite(value) || value <= 0) return;
  saving.value = model;
  error.value = "";
  try {
    await api.models.saveContextWindow("qoder", model, value);
    overrides[model] = Math.floor(value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "save failed";
  } finally {
    saving.value = null;
  }
}

async function resetOverride(model: string) {
  saving.value = model;
  error.value = "";
  try {
    await api.models.removeContextWindow("qoder", model);
    delete overrides[model];
    delete drafts[model];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "reset failed";
  } finally {
    saving.value = null;
  }
}

async function confirmReset() {
  const model = resetTarget.value;
  if (!model) return;
  try {
    await resetOverride(model);
  } finally {
    resetTarget.value = null;
  }
}
</script>

<template>
  <div class="mt-4 w-full border-t border-black/10 pt-4 dark:border-white/10">
    <p class="mb-1 text-sm font-semibold">Model context windows</p>
    <p class="mb-3 text-xs text-muted-foreground">
      Cap each model's context length (tokens). Empty = use the model's default.
    </p>
    <p v-if="loading" class="text-xs text-muted-foreground">Loading...</p>
    <div v-else class="flex flex-col gap-2">
      <p v-if="!models.length" class="text-xs text-muted-foreground">
        No Qoder models listed.
      </p>
      <div
        v-for="m in models"
        :key="m.model || m.id"
        class="flex items-center gap-2"
      >
        <span class="w-44 truncate text-xs">{{ m.model || m.id }}</span>
        <span class="w-24 text-[11px] text-muted-foreground"
          >max {{ formatWindow(m.caps?.contextWindow) }}</span
        >
        <Input
          v-model="drafts[m.model || m.id || '']"
          type="number"
          min="1"
          step="1000"
          class="max-w-[160px]"
          :placeholder="
            m.caps?.contextWindow ? String(m.caps.contextWindow) : 'default'
          "
        />
        <Button
          size="sm"
          variant="secondary"
          :disabled="
            saving === (m.model || m.id) || !drafts[m.model || m.id || '']
          "
          @click="save(m.model || m.id || '')"
          >Save</Button
        >
        <Button
          v-if="overrides[m.model || m.id || ''] != null"
          size="sm"
          variant="ghost"
          :disabled="saving === (m.model || m.id)"
          @click="resetTarget = m.model || m.id || ''"
          >Reset</Button
        >
      </div>
    </div>
    <p v-if="error" class="mt-2 break-words text-xs text-red-500">
      {{ error }}
    </p>
  </div>
  <ConfirmModal
    :open="Boolean(resetTarget)"
    title="Reset context window"
    :message="`Remove the saved context-window override for ${resetTarget || 'this model'}?`"
    confirm-text="Reset"
    :loading="saving === resetTarget"
    @confirm="confirmReset"
    @close="saving !== resetTarget && (resetTarget = null)"
  />
</template>
