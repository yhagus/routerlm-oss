<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useQueryClient } from "@tanstack/vue-query";
import { Plus } from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import { buildMediaProviderSummaries, mediaKindConfig } from "@/lib/media";
import Button from "@/components/ui/button.vue";
import MediaProviderCard from "@/components/media/MediaProviderCard.vue";
import CustomEmbeddingModal from "@/components/media/CustomEmbeddingModal.vue";

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const kind = computed(() => String(route.params.kind || ""));
const config = computed(() => mediaKindConfig(kind.value));
const models = useQuery({
  queryKey: ["gateway-models", kind],
  queryFn: () => api.gateway.models(kind.value),
  enabled: computed(() => Boolean(config.value)),
});
const providers = useQuery({
  queryKey: ["providers", "media", kind],
  queryFn: api.providers.list,
});
const catalog = useQuery({
  queryKey: ["provider-catalog", "media", kind],
  queryFn: () => api.providers.catalog(kind.value),
  enabled: computed(() => Boolean(config.value)),
});
const nodes = useQuery({
  queryKey: ["provider-nodes", "media", kind],
  queryFn: api.nodes.list,
  enabled: computed(() => kind.value === "embedding"),
});
// v1 lists registry providers and custom embedding nodes. It does not create
// extra cards from the public model list.
const customEmbeddingIds = computed(
  () =>
    new Set(
      (nodes.data.value || [])
        .filter((node) => node.type === "custom-embedding")
        .map((node) => node.id),
    ),
);
const summaries = computed(() =>
  buildMediaProviderSummaries(
    [],
    providers.data.value || [],
    [
      ...(catalog.data.value?.providers || []),
      ...(nodes.data.value || [])
        .filter((node) => node.type === "custom-embedding")
        .map((node) => ({
          id: node.id,
          name: node.name || "Custom Embedding",
          noAuth: false,
        })),
    ],
    false,
  ),
);
const showCustomEmbedding = ref(false);

watch(
  kind,
  (value) => {
    if (value === "webSearch" || value === "webFetch")
      router.replace("/dashboard/media-providers/web");
  },
  { immediate: true },
);

function refresh() {
  void models.refetch();
  void providers.refetch();
  void catalog.refetch();
  void nodes.refetch();
}
async function toggleProvider(providerId: string, enabled: boolean) {
  const targets = (providers.data.value || []).filter(
    (connection) => connection.provider === providerId,
  );
  await Promise.all(
    targets.map((connection) =>
      api.providers.update(connection.id, { isActive: enabled }),
    ),
  );
  await queryClient.invalidateQueries({
    queryKey: ["providers", "media", kind],
  });
}
</script>

<template>
  <div class="theme-v2 flex flex-col gap-6">
    <div v-if="kind === 'embedding'" class="flex justify-end">
      <Button @click="showCustomEmbedding = true"
        ><Plus class="size-4" />Add Custom Embedding</Button
      >
    </div>
    <div
      v-if="!config"
      class="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground"
    >
      Unknown media provider kind.
    </div>
    <template v-else
      ><div
        v-if="
          models.isError.value ||
          providers.isError.value ||
          catalog.isError.value
        "
        class="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        {{
          models.error.value?.message ||
          providers.error.value?.message ||
          catalog.error.value?.message ||
          "Could not load media providers."
        }}
      </div>
      <div
        v-else-if="!summaries.length"
        class="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground"
      >
        No providers support <strong>{{ config.label }}</strong> yet.
      </div>
      <div
        v-else
        class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <MediaProviderCard
          v-for="group in summaries"
          :key="group.providerId"
          :group="group"
          :kind="kind"
          :custom="customEmbeddingIds.has(group.providerId)"
          @toggle="toggleProvider"
        /></div
    ></template>
    <CustomEmbeddingModal
      v-if="kind === 'embedding'"
      v-model:open="showCustomEmbedding"
    />
  </div>
</template>
