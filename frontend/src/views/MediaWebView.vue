<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { Globe2, RefreshCw, Search, TextSearch } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { api } from "@/lib/api";
import { buildMediaProviderSummaries } from "@/lib/media";
import PageHeader from "@/components/app/PageHeader.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import Button from "@/components/ui/button.vue";
import Card from "@/components/ui/card.vue";
import Badge from "@/components/ui/badge.vue";
import MediaProviderCard from "@/components/media/MediaProviderCard.vue";

const providers = useQuery({
  queryKey: ["providers", "web"],
  queryFn: api.providers.list,
});
const combos = useQuery({
  queryKey: ["combos", "web"],
  queryFn: api.combos.list,
});
const router = useRouter();
const searchCatalog = useQuery({
  queryKey: ["provider-catalog", "web-search"],
  queryFn: () => api.providers.catalog("webSearch"),
});
const fetchCatalog = useQuery({
  queryKey: ["provider-catalog", "web-fetch"],
  queryFn: () => api.providers.catalog("webFetch"),
});
// v1 renders the registry lists here. Gateway models only power requests.
const searchGroups = computed(() =>
  buildMediaProviderSummaries(
    [],
    providers.data.value || [],
    searchCatalog.data.value?.providers || [],
    false,
  ),
);
const fetchGroups = computed(() =>
  buildMediaProviderSummaries(
    [],
    providers.data.value || [],
    fetchCatalog.data.value?.providers || [],
    false,
  ),
);
const loading = computed(
  () =>
    providers.isPending.value ||
    searchCatalog.isPending.value ||
    fetchCatalog.isPending.value,
);

async function createCombo(kind: "webSearch" | "webFetch") {
  const base = kind === "webSearch" ? "search-combo" : "fetch-combo";
  const existing = new Set(
    (combos.data.value || []).map((combo) => combo.name),
  );
  let name = base;
  let index = 1;
  while (existing.has(name)) name = `${base}-${index++}`;
  const combo = await api.combos.create({ name, models: [], kind });
  await router.push(`/dashboard/media-providers/combo/${combo.id}`);
}

function refresh() {
  void providers.refetch();
  void searchCatalog.refetch();
  void fetchCatalog.refetch();
  void combos.refetch();
}
</script>

<template>
  <div class="theme-v2 space-y-7">
    <PageHeader title="Web tools" description="Web search and fetch providers."
      ><template #actions
        ><Button variant="outline" :disabled="loading" @click="refresh"
          ><RefreshCw
            :class="['size-4', loading && 'animate-spin']"
          />Refresh</Button
        ></template
      ></PageHeader
    >
    <div
      v-if="
        searchCatalog.isError.value ||
        fetchCatalog.isError.value ||
        providers.isError.value
      "
      class="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {{
        searchCatalog.error.value?.message ||
        fetchCatalog.error.value?.message ||
        providers.error.value?.message ||
        "The web capability catalog could not be loaded."
      }}
    </div>
    <div
      v-if="loading"
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      <Skeleton v-for="item in 8" :key="item" class="h-44 rounded-xl" />
    </div>
    <template v-else>
      <section class="space-y-4">
        <div class="flex items-end justify-between gap-3">
          <div class="flex items-center gap-2">
            <div
              class="grid size-9 place-items-center rounded-lg bg-accent text-primary"
            >
              <Search class="size-4" />
            </div>
            <div>
              <h2 class="text-base font-semibold">Web search</h2>
              <p class="text-xs text-muted-foreground">POST /v1/search</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Badge variant="secondary"
              >{{ searchGroups.length }} providers</Badge
            ><Button @click="createCombo('webSearch')">Create Combo</Button>
          </div>
        </div>
        <div
          v-if="
            (combos.data.value || []).filter(
              (combo) => combo.kind === 'webSearch',
            ).length
          "
          class="mb-4 space-y-2"
        >
          <RouterLink
            v-for="combo in (combos.data.value || []).filter(
              (entry) => entry.kind === 'webSearch',
            )"
            :key="combo.id"
            :to="`/dashboard/media-providers/combo/${combo.id}`"
            class="block rounded-lg border px-4 py-3 text-sm hover:bg-muted"
            ><code>{{ combo.name }}</code
            ><span class="ml-2 text-xs text-muted-foreground"
              >{{ combo.models.length }} models</span
            ></RouterLink
          >
        </div>
        <div
          v-if="searchGroups.length"
          class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <MediaProviderCard
            v-for="group in searchGroups"
            :key="group.providerId"
            :group="group"
            kind="webSearch"
          />
        </div>
        <EmptyState
          v-else
          title="No search providers"
          description="No web-search provider or account is configured yet."
        />
      </section>
      <section class="space-y-4 border-t border-border/80 pt-7">
        <div class="flex items-end justify-between gap-3">
          <div class="flex items-center gap-2">
            <div
              class="grid size-9 place-items-center rounded-lg bg-accent text-primary"
            >
              <TextSearch class="size-4" />
            </div>
            <div>
              <h2 class="text-base font-semibold">Web fetch</h2>
              <p class="text-xs text-muted-foreground">POST /v1/web/fetch</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Badge variant="secondary">{{ fetchGroups.length }} providers</Badge
            ><Button @click="createCombo('webFetch')">Create Combo</Button>
          </div>
        </div>
        <div
          v-if="
            (combos.data.value || []).filter(
              (combo) => combo.kind === 'webFetch',
            ).length
          "
          class="mb-4 space-y-2"
        >
          <RouterLink
            v-for="combo in (combos.data.value || []).filter(
              (entry) => entry.kind === 'webFetch',
            )"
            :key="combo.id"
            :to="`/dashboard/media-providers/combo/${combo.id}`"
            class="block rounded-lg border px-4 py-3 text-sm hover:bg-muted"
            ><code>{{ combo.name }}</code
            ><span class="ml-2 text-xs text-muted-foreground"
              >{{ combo.models.length }} models</span
            ></RouterLink
          >
        </div>
        <div
          v-if="fetchGroups.length"
          class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <MediaProviderCard
            v-for="group in fetchGroups"
            :key="group.providerId"
            :group="group"
            kind="webFetch"
          />
        </div>
        <EmptyState
          v-else
          title="No fetch providers"
          description="No web-fetch provider or account is configured yet."
        />
      </section>
    </template>
    <Card class="flex items-start gap-3 p-4 text-sm text-muted-foreground"
      ><Globe2 class="mt-0.5 size-4 shrink-0 text-primary" />
      <p>
        Provider-specific setup lives in provider accounts. Use the examples on
        each provider page to test the canonical gateway endpoints.
      </p></Card
    >
  </div>
</template>
