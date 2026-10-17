<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { Copy, KeyRound, RefreshCw } from "lucide-vue-next";
import { api } from "@/lib/api";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import Input from "@/components/ui/input.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import { useNotificationStore } from "@/stores/notifications";
import ThemeToggle from "@/components/app/ThemeToggle.vue";

const notices = useNotificationStore();
const info = useQuery({
  queryKey: ["connect-info"],
  queryFn: api.connect.info,
});
const usage = useQuery({
  queryKey: ["connect-usage"],
  queryFn: api.connect.usage,
});
const endpoint = `${window.location.origin}/v1`;
const key = computed(() => info.data.value?.keys?.[0] || null);
function limit() {
  if (
    !key.value ||
    key.value.limitMode === "none" ||
    !(Number(key.value.limitValue) > 0)
  )
    return null;
  const used =
    key.value.limitMode === "tokens"
      ? Number(key.value.usageTokens || 0)
      : Number(key.value.usageRequests || 0);
  const max = Number(key.value.limitValue);
  return {
    used,
    max,
    percent: Math.min(100, Math.round((used / max) * 100)),
    unit: key.value.limitMode,
  };
}
async function copy(value: string) {
  await navigator.clipboard?.writeText(value);
  notices.push("success", "Copied to clipboard.");
}
</script>

<template>
  <main class="theme-v2 relative min-h-screen bg-background p-4 sm:p-8">
    <div class="absolute right-4 top-4 z-10"><ThemeToggle /></div>

    <div class="mx-auto max-w-3xl space-y-5">
      <div class="flex items-center justify-between">
        <div>
          <p
            class="text-xs font-semibold uppercase tracking-[.12em] text-primary"
          >
            LobakAI
          </p>
          <h1 class="mt-2 text-2xl font-semibold">Connect a client</h1>
        </div>
        <Button
          variant="outline"
          :disabled="info.isFetching.value"
          @click="info.refetch()"
          ><RefreshCw class="size-4" />Refresh</Button
        >
      </div>
      <Card class="p-5 sm:p-6"
        ><div class="flex items-start gap-3">
          <div
            class="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"
          >
            <KeyRound class="size-4" />
          </div>
          <div>
            <h2 class="font-semibold">Gateway endpoint</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Use this base URL in an OpenAI-compatible client.
            </p>
          </div>
        </div>
        <div class="mt-5 flex gap-2">
          <Input :model-value="endpoint" readonly class="font-mono" /><Button
            variant="outline"
            size="icon"
            aria-label="Copy endpoint"
            @click="copy(endpoint)"
            ><Copy class="size-4"
          /></Button>
        </div>
        <div class="mt-4 rounded-lg border p-4">
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="success">Public key</Badge
            ><span class="text-sm font-medium">{{
              key?.name || "No public key configured"
            }}</span>
          </div>
          <code
            v-if="key?.key"
            class="mt-3 block break-all rounded bg-muted p-2 text-xs"
            >{{ key.key }}</code
          >
          <p v-else class="mt-2 text-xs text-muted-foreground">
            Ask the dashboard owner to configure a public key.
          </p>
          <div v-if="limit()" class="mt-4">
            <div class="flex justify-between text-xs text-muted-foreground">
              <span>Usage limit</span
              ><span
                >{{ limit()?.used }} / {{ limit()?.max }}
                {{ limit()?.unit }}</span
              >
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full bg-primary"
                :style="{ width: `${limit()?.percent}%` }"
              />
            </div>
          </div></div></Card
      ><Card class="p-5 sm:p-6"
        ><div class="flex items-center justify-between">
          <div>
            <h2 class="font-semibold">Usage by combo</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Cached public-key usage, refreshed every minute.
            </p>
          </div>
          <Badge variant="secondary">{{
            usage.data.value?.models?.length || 0
          }}</Badge>
        </div>
        <div
          v-if="usage.isPending.value"
          class="mt-5 space-y-3"
          role="status"
          aria-label="Loading usage"
        >
          <div
            v-for="row in 3"
            :key="row"
            class="flex items-center justify-between gap-3"
          >
            <Skeleton class="h-3.5 w-40" />
            <Skeleton class="h-3 w-28" />
          </div>
        </div>
        <div
          v-else-if="!usage.data.value?.models?.length"
          class="mt-5 rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground"
        >
          No usage recorded yet.
        </div>
        <div v-else class="mt-4 divide-y">
          <div
            v-for="model in usage.data.value.models"
            :key="String(model.model)"
            class="flex items-center justify-between gap-3 py-3"
          >
            <code
              class="min-w-0 truncate text-xs"
              :title="String(model.model)"
              >{{ model.model }}</code
            ><span class="shrink-0 text-xs text-muted-foreground"
              >{{ model.inputTokens }} in · {{ model.outputTokens }} out</span
            >
          </div>
        </div></Card
      >
    </div>
  </main>
</template>
