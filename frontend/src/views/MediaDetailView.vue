<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  ArrowLeft,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Settings2,
  TestTube2,
} from "lucide-vue-next";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import { mediaKindConfig, modelForProvider } from "@/lib/media";
import PageHeader from "@/components/app/PageHeader.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import MediaRequestPanel from "@/components/media/MediaRequestPanel.vue";
import { useNotificationStore } from "@/stores/notifications";

const route = useRoute();
const router = useRouter();
const notices = useNotificationStore();
const kind = computed(() => String(route.params.kind || ""));
const providerId = computed(() =>
  decodeURIComponent(String(route.params.id || "")),
);
const config = computed(() => mediaKindConfig(kind.value));
const providers = useQuery({
  queryKey: ["providers", "media-detail", providerId],
  queryFn: api.providers.list,
});
const catalog = useQuery({
  queryKey: ["provider-catalog", "media-detail", providerId],
  queryFn: () => api.providers.catalog(),
});
const models = useQuery({
  queryKey: ["gateway-models", kind],
  queryFn: () => api.gateway.models(kind.value),
  enabled: computed(() => Boolean(config.value)),
});
const testing = ref(false);
const active = computed(
  () =>
    providers.data.value?.filter(
      (provider) => provider.provider === providerId.value,
    ) || [],
);
const provider = computed(() => active.value[0] || null);
const providerModels = computed(() =>
  (models.data.value?.data || []).filter((model) =>
    modelForProvider(model, providerId.value),
  ),
);
const displayName = computed(() => provider.value?.name || providerId.value);
const catalogProvider = computed(
  () =>
    catalog.data.value?.providers.find(
      (entry) => entry.id === providerId.value,
    ) || null,
);
const providerDisplay = computed(
  () => (catalogProvider.value?.display || {}) as Record<string, unknown>,
);
const apiKeyUrl = computed(() =>
  String(
    (providerDisplay.value.notice as Record<string, unknown> | undefined)
      ?.apiKeyUrl || "",
  ),
);

async function testConnections() {
  if (!active.value.length || testing.value) return;
  testing.value = true;
  const results = await Promise.allSettled(
    active.value.map((connection) => api.providers.test(connection.id)),
  );
  const successful = results.filter(
    (result) => result.status === "fulfilled" && result.value.ok,
  ).length;
  notices.push(
    successful === active.value.length ? "success" : "error",
    `${successful} of ${active.value.length} connection test(s) succeeded.`,
    "Connection test",
  );
  testing.value = false;
  void providers.refetch();
}
</script>

<template>
  <div class="theme-v2 space-y-6">
    <RouterLink
      :to="
        kind === 'webSearch' || kind === 'webFetch'
          ? '/dashboard/media-providers/web'
          : `/dashboard/media-providers/${kind}`
      "
      class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
      ><ArrowLeft class="size-4" />Back to
      {{ config?.label || "media" }}</RouterLink
    >
    <PageHeader
      :title="catalogProvider?.name || displayName"
      :description="config?.description || 'Provider request example.'"
      ><template #actions
        ><a v-if="apiKeyUrl" :href="apiKeyUrl" target="_blank" rel="noreferrer"
          ><Button variant="outline"
            ><ExternalLink class="size-4" />Get API Key</Button
          ></a
        ><Button
          variant="outline"
          @click="router.push(`/dashboard/providers/${providerId}`)"
          ><Settings2 class="size-4" />Provider settings</Button
        ><Button
          variant="outline"
          :disabled="testing || !active.length"
          @click="testConnections"
          ><LoaderCircle v-if="testing" class="size-4 animate-spin" /><TestTube2
            v-else
            class="size-4"
          />Test connections</Button
        ></template
      ></PageHeader
    >

    <EmptyState
      v-if="!config"
      title="Unknown media capability"
      description="This route does not map to a media capability."
    />
    <template v-else>
      <div
        v-if="models.isError.value"
        class="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        {{ models.error.value?.message }}
      </div>
      <div
        v-if="catalogProvider"
        class="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm"
      >
        <Badge v-if="catalogProvider.noAuth" variant="success">Ready</Badge
        ><Badge
          v-for="service in catalogProvider.serviceKinds"
          :key="service"
          variant="secondary"
          >{{ service }}</Badge
        ><span class="text-muted-foreground"
          >{{ active.length }} configured connection{{
            active.length === 1 ? "" : "s"
          }}</span
        >
      </div>
      <div
        v-else-if="!provider && !providerModels.length"
        class="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-muted-foreground"
      >
        No live provider account or catalog model matches
        <code class="font-mono">{{ providerId }}</code
        >. Add the provider or model before sending a request.
      </div>
      <MediaRequestPanel
        v-if="!models.isPending.value"
        :kind="kind"
        :provider-id="providerId"
        :models="providerModels"
      />
      <Card v-if="providerModels.length" class="p-5"
        ><div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold">Models for this route</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              Live catalog returned by the v2 gateway.
            </p>
          </div>
          <Button
            variant="ghost"
            :disabled="models.isFetching.value"
            @click="models.refetch()"
            ><RefreshCw
              :class="['size-4', models.isFetching.value && 'animate-spin']"
            />Refresh</Button
          >
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <Badge
            v-for="model in providerModels"
            :key="model.id"
            variant="secondary"
            class="font-mono"
            >{{ model.id }}</Badge
          >
        </div></Card
      >
    </template>
  </div>
</template>
