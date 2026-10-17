<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { Activity, HeartPulse, RefreshCw, ShieldAlert } from "lucide-vue-next";
import { api } from "@/lib/api";
import { number } from "@/lib/format";
import PageHeader from "@/components/app/PageHeader.vue";
import StatTile from "@/components/app/StatTile.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import Card from "@/components/ui/card.vue";
import { useNotificationStore } from "@/stores/notifications";

const notices = useNotificationStore();
const status = useQuery({
  queryKey: ["pxpipe", "status"],
  queryFn: api.host.pxpipe.status,
});
const stats = useQuery({
  queryKey: ["pxpipe", "stats"],
  queryFn: api.host.pxpipe.stats,
});
const logs = useQuery({
  queryKey: ["pxpipe", "logs"],
  queryFn: api.host.pxpipe.logs,
});
const health = useQuery({
  queryKey: ["pxpipe", "health"],
  queryFn: api.host.pxpipe.health,
  enabled: false,
});
const action = ref("");
const all = computed(() => {
  const windows = stats.data.value?.windows;
  return windows && typeof windows === "object" && !Array.isArray(windows)
    ? ((windows as Record<string, unknown>).all as Record<string, unknown>) ||
        {}
    : {};
});
const busy = computed(
  () =>
    Boolean(action.value) ||
    status.isFetching.value ||
    stats.isFetching.value ||
    logs.isFetching.value ||
    health.isFetching.value,
);

function windowSaved(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return number((value as Record<string, unknown>).tokensSavedEst);
  }
  return "-";
}

async function refresh() {
  await Promise.all([status.refetch(), stats.refetch(), logs.refetch()]);
}
async function run(name: string, operation: () => Promise<unknown>) {
  action.value = name;
  try {
    await operation();
    await refresh();
    notices.push("success", `${name} completed.`);
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : `${name} failed.`,
    );
  } finally {
    action.value = "";
  }
}

function runConfirmed(name: string, operation: () => Promise<unknown>) {
  if (!window.confirm(`${name} can interrupt local requests. Continue?`))
    return;
  void run(name, operation);
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="PXPIPE"
      description="Operate prompt-image compression and inspect its aggregate telemetry."
      ><template #actions
        ><Button variant="outline" size="sm" :disabled="busy" @click="refresh"
          ><RefreshCw :class="['size-4', busy && 'animate-spin']" />Refresh
          telemetry</Button
        ></template
      ></PageHeader
    >
    <div
      v-if="status.isError.value || stats.isError.value || logs.isError.value"
      role="alert"
      class="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
    >
      <ShieldAlert class="mt-0.5 size-4 shrink-0" />
      <p>
        {{
          (status.error.value ||
            stats.error.value ||
            logs.error.value) instanceof Error
            ? (status.error.value || stats.error.value || logs.error.value)
                ?.message
            : "PXPIPE telemetry could not be loaded."
        }}
      </p>
    </div>
    <div class="grid gap-3 sm:grid-cols-4">
      <StatTile
        label="Runtime"
        :value="
          status.isPending.value
            ? '...'
            : status.data.value?.running
              ? 'Running'
              : 'Stopped'
        "
        :detail="String(status.data.value?.mode || 'unknown mode')"
        :tone="status.data.value?.running ? 'success' : 'warning'"
      /><StatTile
        label="Requests"
        :value="stats.isPending.value ? '...' : number(all.requests)"
        detail="Compression requests"
      /><StatTile
        label="Compressed"
        :value="stats.isPending.value ? '...' : number(all.compressed)"
        detail="Requests processed"
        tone="success"
      /><StatTile
        label="Tokens saved"
        :value="stats.isPending.value ? '...' : number(all.tokensSavedEst)"
        detail="Estimated all-time savings"
        tone="success"
      />
    </div>
    <Card class="flex items-start gap-3 border-primary/15 bg-accent/35 p-5"
      ><Activity class="mt-0.5 size-4 shrink-0 text-primary" />
      <div>
        <h2 class="text-sm font-semibold">Live runtime controls</h2>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">
          Start, stop, install, restart, and health-check operations are
          connected to the local v2 host runtime.
        </p>
      </div></Card
    >
    <div class="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Card class="overflow-hidden"
        ><div
          class="flex items-center gap-3 border-b border-border/70 px-5 py-4"
        >
          <div
            class="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"
          >
            <Activity class="size-4" />
          </div>
          <div>
            <h2 class="text-sm font-semibold">Runtime details</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              Current process and configuration state.
            </p>
          </div>
          <Badge
            class="ml-auto"
            :variant="status.data.value?.running ? 'success' : 'secondary'"
            >{{ status.data.value?.running ? "Running" : "Stopped" }}</Badge
          >
        </div>
        <dl class="divide-y px-5">
          <div class="flex justify-between gap-4 py-3 text-sm">
            <dt class="text-muted-foreground">Installed</dt>
            <dd>{{ status.data.value?.installed ? "Yes" : "No" }}</dd>
          </div>
          <div class="flex justify-between gap-4 py-3 text-sm">
            <dt class="text-muted-foreground">Version</dt>
            <dd>{{ status.data.value?.version || "-" }}</dd>
          </div>
          <div class="flex justify-between gap-4 py-3 text-sm">
            <dt class="text-muted-foreground">Configured enabled</dt>
            <dd>{{ status.data.value?.enabled ? "Yes" : "No" }}</dd>
          </div>
          <div class="flex justify-between gap-4 py-3 text-sm">
            <dt class="text-muted-foreground">Minimum chars</dt>
            <dd>{{ String(status.data.value?.minChars || 0) }}</dd>
          </div>
          <div class="flex justify-between gap-4 py-3 text-sm">
            <dt class="text-muted-foreground">Timeout</dt>
            <dd>{{ String(status.data.value?.timeoutMs || 0) }} ms</dd>
          </div>
        </dl>
        <div class="flex flex-wrap gap-2 border-t border-border/70 px-5 py-4">
          <Button
            size="sm"
            :disabled="busy"
            @click="run('PXPIPE start', api.host.pxpipe.start)"
            >Start</Button
          ><Button
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="runConfirmed('PXPIPE stop', api.host.pxpipe.stop)"
            >Stop</Button
          ><Button
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="runConfirmed('PXPIPE restart', api.host.pxpipe.restart)"
            >Restart</Button
          ><Button
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="runConfirmed('PXPIPE install', api.host.pxpipe.install)"
            >Install</Button
          ><Button
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="run('PXPIPE health check', api.host.pxpipe.health)"
            ><HeartPulse class="size-4" />Health check</Button
          >
        </div></Card
      ><Card class="p-5"
        ><h2 class="text-sm font-semibold">Compression windows</h2>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">
          Recent processing windows returned by the runtime.
        </p>
        <dl class="mt-4 divide-y">
          <div
            v-for="(value, key) in stats.data.value?.windows || {}"
            :key="key"
            class="flex items-center justify-between gap-3 py-3 text-sm"
          >
            <dt class="capitalize text-muted-foreground">{{ key }}</dt>
            <dd class="font-mono text-xs">{{ windowSaved(value) }} saved</dd>
          </div>
        </dl></Card
      >
    </div>
    <Card v-if="health.data.value" class="p-5"
      ><h2 class="text-sm font-semibold">Latest health check</h2>
      <pre
        class="mt-3 max-h-64 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs"
        >{{ JSON.stringify(health.data.value, null, 2) }}</pre>
    </Card>
  </div>
</template>
