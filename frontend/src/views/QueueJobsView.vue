<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import { api, describeApiError } from "@/lib/api";
import type { QueueJob, QueueJobStatus } from "@/types/api";

const REFRESH_INTERVAL_MS = 5_000;

const jobs = ref<QueueJob[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const error = ref<string | null>(null);
const fetchedAt = ref<string | null>(null);
const autoRefresh = ref(true);
const removingId = ref<string | null>(null);
const clearConfirmOpen = ref(false);
const clearing = ref(false);
const filter = ref<"all" | QueueJobStatus>("all");

let intervalId: number | undefined;

const filtered = computed(() =>
  filter.value === "all"
    ? jobs.value
    : jobs.value.filter((j) => j.status === filter.value),
);

const counts = computed(() => {
  const c: Record<string, number> = {
    all: jobs.value.length,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const j of jobs.value) c[j.status] = (c[j.status] || 0) + 1;
  return c;
});

function statusBadge(status: QueueJobStatus) {
  switch (status) {
    case "queued":
      return { variant: "secondary" as const, label: "Queued" };
    case "running":
      return { variant: "info" as const, label: "Running" };
    case "completed":
      return { variant: "success" as const, label: "Completed" };
    case "failed":
      return { variant: "destructive" as const, label: "Failed" };
    case "cancelled":
      return { variant: "warning" as const, label: "Cancelled" };
    default:
      return { variant: "outline" as const, label: status };
  }
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatElapsed(job: QueueJob) {
  const start = job.startedAt ? Date.parse(job.startedAt) : null;
  const end = job.finishedAt
    ? Date.parse(job.finishedAt)
    : job.status === "running"
      ? Date.now()
      : null;
  if (!start || !end) return "—";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

async function load(silent = false) {
  if (!silent) refreshing.value = true;
  try {
    const data = await api.queueJobs.list();
    jobs.value = data.jobs;
    fetchedAt.value = new Date().toISOString();
    error.value = null;
  } catch (err) {
    error.value = describeApiError(err);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function removeJob(job: QueueJob) {
  removingId.value = job.jobId;
  try {
    await api.queueJobs.remove(job.jobId);
    jobs.value = jobs.value.filter((j) => j.jobId !== job.jobId);
  } catch (err) {
    error.value = describeApiError(err);
    await load(true);
  } finally {
    removingId.value = null;
  }
}

async function clearAll() {
  clearing.value = true;
  try {
    await api.queueJobs.clearAll();
    jobs.value = [];
    clearConfirmOpen.value = false;
  } catch (err) {
    error.value = describeApiError(err);
  } finally {
    clearing.value = false;
  }
}

function startTimer() {
  stopTimer();
  if (autoRefresh.value)
    intervalId = window.setInterval(() => load(true), REFRESH_INTERVAL_MS);
}

function stopTimer() {
  if (intervalId) {
    window.clearInterval(intervalId);
    intervalId = undefined;
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  if (autoRefresh.value) startTimer();
  else stopTimer();
}

onMounted(() => {
  load();
  startTimer();
});

onUnmounted(stopTimer);
</script>

<template>
  <div class="theme-v2 flex min-w-0 flex-col gap-4 px-1 sm:px-0">
    <div
      class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="min-w-0">
        <p class="text-sm text-muted-foreground">
          Live in-memory background jobs across all registries. These lists
          reset on server restart.
        </p>
        <p v-if="fetchedAt" class="mt-0.5 text-[11px] text-muted-foreground">
          Updated {{ formatTime(fetchedAt) }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button variant="ghost" :disabled="refreshing" @click="load()">
          <span class="material-symbols-outlined text-[16px]">refresh</span>
          {{ refreshing ? "Refreshing..." : "Refresh" }}
        </Button>
        <Button
          :variant="autoRefresh ? 'secondary' : 'ghost'"
          @click="toggleAutoRefresh"
        >
          <span class="material-symbols-outlined text-[16px]">{{
            autoRefresh ? "pause" : "play_arrow"
          }}</span>
          Auto-refresh
        </Button>
        <Button
          variant="outline"
          :disabled="!jobs.length || clearing"
          @click="clearConfirmOpen = true"
        >
          <span class="material-symbols-outlined text-[16px]"
            >delete_sweep</span
          >
          Clear all
        </Button>
      </div>
    </div>

    <div
      v-if="error"
      class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {{ error }}
    </div>

    <Card class="overflow-hidden">
      <div
        class="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2"
      >
        <button
          v-for="opt in [
            { k: 'all', label: 'All' },
            { k: 'queued', label: 'Queued' },
            { k: 'running', label: 'Running' },
            { k: 'completed', label: 'Completed' },
            { k: 'failed', label: 'Failed' },
            { k: 'cancelled', label: 'Cancelled' },
          ]"
          :key="opt.k"
          type="button"
          :class="[
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            filter === opt.k
              ? 'bg-primary/12 text-primary'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          ]"
          @click="filter = opt.k as any"
        >
          {{ opt.label }}
          <span class="ml-1 text-[10px] opacity-70">{{
            counts[opt.k] || 0
          }}</span>
        </button>
      </div>

      <div
        v-if="loading"
        class="px-4 py-8 text-center text-sm text-muted-foreground"
      >
        Loading jobs...
      </div>
      <div
        v-else-if="!filtered.length"
        class="px-4 py-12 text-center text-sm text-muted-foreground"
      >
        No jobs in this view.
      </div>
      <div v-else class="divide-y divide-border">
        <div
          v-for="job in filtered"
          :key="job.jobId"
          class="flex items-start gap-3 px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <Badge :variant="statusBadge(job.status).variant" dot>{{
                statusBadge(job.status).label
              }}</Badge>
              <Badge variant="outline">{{ job.source }}</Badge>
              <code class="text-[11px] text-muted-foreground">{{
                job.jobId
              }}</code>
            </div>
            <div
              class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] text-muted-foreground"
            >
              <span v-if="job.stage">
                <span class="text-foreground/70">Stage:</span> {{ job.stage }}
              </span>
              <span>
                <span class="text-foreground/70">Started:</span>
                {{ formatTime(job.startedAt) }}
              </span>
              <span>
                <span class="text-foreground/70">Finished:</span>
                {{ formatTime(job.finishedAt) }}
              </span>
              <span>
                <span class="text-foreground/70">Elapsed:</span>
                {{ formatElapsed(job) }}
              </span>
            </div>
            <p v-if="job.error" class="mt-1 text-[12px] text-destructive">
              {{ job.error }}
            </p>
            <p
              v-if="job.detail"
              class="mt-1 font-mono text-[11px] text-muted-foreground/80"
            >
              {{ JSON.stringify(job.detail) }}
            </p>
          </div>
          <Button
            variant="ghost"
            :disabled="removingId === job.jobId"
            class="shrink-0 text-muted-foreground hover:text-destructive"
            :title="'Delete job'"
            @click="removeJob(job)"
          >
            <span class="material-symbols-outlined text-[16px]">delete</span>
          </Button>
        </div>
      </div>
    </Card>
  </div>

  <ConfirmModal
    :open="clearConfirmOpen"
    title="Clear all jobs"
    message="Remove every job from every in-memory registry? This action cannot be undone."
    confirm-text="Clear all"
    :loading="clearing"
    @confirm="clearAll"
    @close="!clearing && (clearConfirmOpen = false)"
    class="theme-v2"
  />
</template>
