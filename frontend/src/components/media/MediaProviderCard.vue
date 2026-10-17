<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { MediaProviderSummary } from "@/lib/media";
import Badge from "@/components/ui/badge.vue";
import Toggle from "@/components/ui/toggle.vue";
import ProviderLogo from "@/components/app/ProviderLogo.vue";

const props = defineProps<{
  group: MediaProviderSummary;
  kind: string;
  custom?: boolean;
}>();
const emit = defineEmits<{ toggle: [providerId: string, enabled: boolean] }>();
const connections = computed(() => props.group.connections);
const disabled = computed(
  () =>
    connections.value.length > 0 &&
    connections.value.every((connection) => connection.isActive === false),
);
const connected = computed(
  () =>
    connections.value.filter(
      (connection) =>
        connection.isActive &&
        ["active", "success", "unknown", ""].includes(
          String(connection.testStatus || ""),
        ),
    ).length,
);
const errors = computed(
  () =>
    connections.value.filter((connection) =>
      ["error", "expired", "unavailable"].includes(
        String(connection.testStatus || ""),
      ),
    ).length,
);
const color = computed(() => String(props.group.display?.color || "#888"));
</script>

<template>
  <RouterLink
    :to="`/dashboard/media-providers/${kind}/${encodeURIComponent(group.providerId)}`"
    class="group block h-full"
  >
    <div
      class="h-full rounded-xl border bg-card p-3 transition-colors hover:bg-muted/50"
      :class="disabled && 'opacity-50'"
    >
      <div class="flex min-w-0 items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div
            class="grid size-8 shrink-0 place-items-center rounded-lg"
            :style="{ backgroundColor: `${color}15` }"
          >
            <ProviderLogo
              :provider="group.providerId"
              :label="group.name"
              size="size-7"
            />
          </div>
          <div class="min-w-0">
            <h3 class="truncate text-sm font-semibold">{{ group.name }}</h3>
            <div class="mt-0.5 flex flex-wrap items-center gap-2">
              <Badge v-if="custom" variant="secondary">Custom</Badge
              ><Badge v-else-if="group.noAuth" variant="success">Ready</Badge
              ><Badge v-else-if="disabled" variant="secondary">Disabled</Badge
              ><span
                v-else-if="!connections.length"
                class="text-xs text-muted-foreground"
                >No connections</span
              ><Badge v-if="connected" variant="success"
                >{{ connected }} Connected</Badge
              ><Badge v-if="errors" variant="destructive"
                >{{ errors }} Error</Badge
              ><Badge
                v-if="connections.length && !connected && !errors && !disabled"
                variant="secondary"
                >{{ connections.length }} Added</Badge
              >
            </div>
          </div>
        </div>
        <div
          v-if="connections.length"
          class="shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
          @click.prevent.stop="emit('toggle', group.providerId, disabled)"
        >
          <Toggle
            :checked="!disabled"
            :title="disabled ? 'Enable provider' : 'Disable provider'"
          />
        </div>
      </div>
    </div>
  </RouterLink>
</template>
