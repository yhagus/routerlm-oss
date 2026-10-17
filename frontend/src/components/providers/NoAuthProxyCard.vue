<script setup lang="ts">
// Port of v1 NoAuthProxyCard — free no-auth providers route through a proxy
// pool configured per provider via providerStrategies overrides.
import { computed, onMounted, ref } from "vue";
import { api } from "@/lib/api";
import Card from "@/components/ui/card.vue";
import Badge from "@/components/ui/badge.vue";
import Combobox from "@/components/ui/combobox.vue";
import Select from "@/components/ui/select.vue";

const NONE_PROXY_POOL_VALUE = "__none__";
const STRATEGIES = [
  { value: "none", label: "None (single pool)" },
  { value: "round-robin", label: "Round-robin" },
  { value: "random", label: "Random" },
];

const props = withDefaults(
  defineProps<{ providerId: string; title?: string; description?: string }>(),
  {
    title: "Connections",
    description:
      "This provider needs no credentials. Traffic is routed through a proxy pool.",
  },
);

const proxyPools = ref<Array<{ id: string; name: string; isActive?: boolean }>>(
  [],
);
const proxyPoolId = ref(NONE_PROXY_POOL_VALUE);
const rotateStrategy = ref("none");
const saving = ref(false);
const savedFlash = ref(false);
const proxyPoolOptions = computed(() => [
  { value: NONE_PROXY_POOL_VALUE, label: "None" },
  ...proxyPools.value.map((pool) => ({ value: pool.id, label: pool.name })),
]);

onMounted(async () => {
  try {
    const [poolData, settingsData] = await Promise.all([
      api.proxies
        .list()
        .then((pools) => pools)
        .catch(() => []),
      api.settings.get().catch(() => ({}) as Record<string, unknown>),
    ]);
    proxyPools.value = (
      (poolData as unknown as Array<{
        id: string;
        name: string;
        isActive?: boolean;
      }>) || []
    ).filter((pool) => pool.isActive !== false);
    const override =
      ((
        settingsData as {
          providerStrategies?: Record<string, Record<string, unknown>>;
        }
      ).providerStrategies || {})[props.providerId] || {};
    proxyPoolId.value =
      (override.proxyPoolId as string) || NONE_PROXY_POOL_VALUE;
    rotateStrategy.value = (override.rotateStrategy as string) || "none";
  } catch {
    /* defaults */
  }
});

async function save(poolId: string, strategy: string) {
  saving.value = true;
  try {
    const data = await api.settings.get();
    const current = (data.providerStrategies || {}) as Record<
      string,
      Record<string, unknown>
    >;
    const override = { ...(current[props.providerId] || {}) };
    if (poolId === NONE_PROXY_POOL_VALUE) delete override.proxyPoolId;
    else override.proxyPoolId = poolId;
    if (strategy === "none") delete override.rotateStrategy;
    else override.rotateStrategy = strategy;
    const updated = { ...current };
    if (Object.keys(override).length === 0) delete updated[props.providerId];
    else updated[props.providerId] = override;
    await api.settings.update({ providerStrategies: updated });
    savedFlash.value = true;
    window.setTimeout(() => {
      savedFlash.value = false;
    }, 1500);
  } finally {
    saving.value = false;
  }
}

function handlePoolChange(value: string | number) {
  const next = String(value);
  proxyPoolId.value = next;
  save(next, rotateStrategy.value);
}
function handleStrategyChange(value: string | number) {
  const next = String(value);
  rotateStrategy.value = next;
  save(proxyPoolId.value, next);
}
</script>

<template>
  <Card class="p-5 sm:p-6">
    <div class="mb-4 flex items-center gap-3">
      <div
        class="inline-flex size-10 items-center justify-center rounded-full bg-green-500/10 text-green-500"
      >
        <span class="material-symbols-outlined text-[20px]">lock_open</span>
      </div>
      <div>
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <p class="text-sm text-muted-foreground">{{ description }}</p>
      </div>
    </div>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div class="flex-1 space-y-2">
        <label class="text-sm font-medium" for="noauth-proxy-pool"
          >Proxy Pool</label
        >
        <Combobox
          id="noauth-proxy-pool"
          v-model="proxyPoolId"
          :options="proxyPoolOptions"
          :disabled="saving"
          placeholder="Search proxy pools..."
          empty-text="No active proxy pools"
          @update:model-value="handlePoolChange"
        />
      </div>
      <div class="flex-1 space-y-2">
        <label class="text-sm font-medium" for="noauth-rotate">Rotate</label>
        <Select
          id="noauth-rotate"
          v-model="rotateStrategy"
          :options="STRATEGIES"
          :disabled="saving || proxyPools.length < 2"
          @update:model-value="handleStrategyChange"
        />
      </div>
      <Badge v-if="savedFlash" variant="success">Saved</Badge>
    </div>
    <p v-if="proxyPools.length < 2" class="mt-3 text-xs text-muted-foreground">
      Rotation needs at least two active proxy pools.
    </p>
  </Card>
</template>
