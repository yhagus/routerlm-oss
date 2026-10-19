<script setup lang="ts">
// Port of v1 bulk Apply Proxy modal — one-to-one rotate, unbind all, or bind a pool.
import { computed, ref } from "vue";
import type { ProviderConnection, ProxyPool } from "@/types/api";
import Modal from "@/components/ui/modal.vue";
import Button from "@/components/ui/button.vue";

const props = defineProps<{
  open: boolean;
  connections: ProviderConnection[];
  selectedConnections: ProviderConnection[];
  proxyPools: ProxyPool[];
}>();
const emit = defineEmits<{
  close: [];
  apply: [
    assignments: Array<{ connectionId: string; proxyPoolId: string | null }>,
  ];
}>();

const updating = ref(false);
// The selection when one exists, else every connection of the provider.
const targets = computed(() =>
  props.selectedConnections.length
    ? props.selectedConnections
    : props.connections,
);
const activePools = computed(() =>
  props.proxyPools.filter((pool) => pool.isActive === true),
);

const selectedProxySummary = computed(() => {
  if (props.selectedConnections.length === 0) return "";
  const poolIds = new Set(
    props.selectedConnections.map((connection) =>
      String(
        (connection.data as Record<string, unknown> | undefined)?.proxyPoolId ||
          "__none__",
      ),
    ),
  );
  if (poolIds.size === 1) {
    const onlyId = [...poolIds][0];
    if (onlyId === "__none__") return "All selected currently unbound";
    const pool = props.proxyPools.find((p) => p.id === onlyId);
    return `All selected currently bound to ${pool?.name || onlyId}`;
  }
  return "Selected connections have mixed proxy bindings";
});

function close() {
  if (!updating.value) emit("close");
}

function apply(
  assignments: Array<{ connectionId: string; proxyPoolId: string | null }>,
) {
  emit("apply", assignments);
}

function applySinglePool(proxyPoolId: string | null) {
  return apply(
    targets.value.map((connection) => ({
      connectionId: connection.id,
      proxyPoolId,
    })),
  );
}

function applyOneToOne() {
  if (activePools.value.length === 0) {
    window.alert("No active proxy pools available.");
    return;
  }
  return apply(
    targets.value.map((connection, index) => ({
      connectionId: connection.id,
      proxyPoolId: activePools.value[index % activePools.value.length].id,
    })),
  );
}
</script>

<template>
  <Modal
    :open="open"
    :title="`Apply Proxy (${targets.length} ${selectedConnections.length ? 'selected' : 'connections'})`"
    @close="close"
  >
    <div class="flex flex-col gap-3">
      <p v-if="selectedProxySummary" class="text-xs text-muted-foreground">
        {{ selectedProxySummary }}
      </p>
      <div class="flex flex-col">
        <button
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.04]"
          :disabled="updating || activePools.length === 0"
          @click="applyOneToOne"
        >
          <span
            class="material-symbols-outlined text-[18px] text-muted-foreground"
            >sync_alt</span
          >
          <span class="text-sm">One-to-one (rotate)</span>
        </button>
        <button
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.04]"
          :disabled="updating"
          @click="applySinglePool(null)"
        >
          <span
            class="material-symbols-outlined text-[18px] text-muted-foreground"
            >link_off</span
          >
          <span class="text-sm">None (unbind)</span>
        </button>
        <button
          v-for="pool in proxyPools"
          :key="pool.id"
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.04]"
          :disabled="updating || pool.isActive !== true"
          @click="applySinglePool(pool.id)"
        >
          <span
            class="material-symbols-outlined text-[18px] text-muted-foreground"
            >lan</span
          >
          <span class="truncate text-sm">{{ pool.name }}</span>
          <span
            v-if="pool.isActive !== true"
            class="text-[10px] text-muted-foreground"
            >(inactive)</span
          >
        </button>
      </div>
      <p v-if="updating" class="text-xs text-muted-foreground">Applying...</p>
      <Button variant="ghost" class="w-full" :disabled="updating" @click="close"
        >Cancel</Button
      >
    </div>
  </Modal>
</template>
