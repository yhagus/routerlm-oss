<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ArrowLeft, KeyRound, Save } from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import type { ApiKey } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import { useNotificationStore } from "@/stores/notifications";

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const notices = useNotificationStore();
const id = computed(() => String(route.params.id || ""));

const combo = useQuery({
  queryKey: ["combo", id],
  queryFn: () => api.combos.get(id.value),
});
const keys = useQuery({
  queryKey: ["keys"],
  queryFn: api.keys.list,
});

const comboName = computed(() => combo.data.value?.name || "");

function canUse(key: ApiKey, name: string): boolean {
  const mode = key.comboAccessMode === "whitelist" ? "whitelist" : "blacklist";
  const listed = (key.comboAccessList || []).includes(name);
  return mode === "whitelist" ? listed : !listed;
}

function modeLabel(key: ApiKey): string {
  return key.comboAccessMode === "whitelist" ? "Whitelist" : "Blacklist";
}

const checked = ref<Set<string>>(new Set());
const initial = ref<Set<string>>(new Set());

watch(
  [() => keys.data.value, comboName],
  ([list, name]) => {
    if (!Array.isArray(list) || !name) return;
    const next = new Set(
      list.filter((key) => canUse(key, name)).map((key) => key.id),
    );
    checked.value = next;
    initial.value = new Set(next);
  },
  { immediate: true },
);

function toggle(keyId: string) {
  const next = new Set(checked.value);
  if (next.has(keyId)) next.delete(keyId);
  else next.add(keyId);
  checked.value = next;
}

const dirty = computed(() => {
  if (checked.value.size !== initial.value.size) return true;
  for (const keyId of checked.value) {
    if (!initial.value.has(keyId)) return true;
  }
  return false;
});

const save = useMutation({
  mutationFn: () => api.combos.consumers(id.value, [...checked.value]),
  onSuccess: (result) => {
    const updated = Number(result?.updated) || 0;
    notices.push(
      "success",
      `Updated ${updated} API key${updated === 1 ? "" : "s"}.`,
    );
    void queryClient.invalidateQueries({ queryKey: ["keys"] });
  },
  onError: (error) =>
    notices.push("error", error.message, "Could not save consumers"),
});
</script>

<template>
  <div v-if="combo.isPending.value" class="space-y-6">
    <div class="h-16 animate-pulse rounded-xl bg-muted" />
    <div class="h-64 animate-pulse rounded-xl bg-muted" />
  </div>
  <div v-else-if="combo.isError.value || !combo.data.value" class="space-y-6">
    <PageHeader
      title="Combo consumers"
      description="The requested combo could not be loaded."
    /><EmptyState
      title="Combo not found"
      description="This combo may have been removed or the route id is invalid."
      ><Button @click="router.push('/dashboard/combos')"
        ><ArrowLeft class="size-4" />Back to combos</Button
      ></EmptyState
    >
  </div>
  <div v-else class="space-y-6">
    <PageHeader
      :title="`Consumers: ${combo.data.value.name}`"
      description="Choose which API keys may use this combo."
    >
      <template #actions
        ><Button
          variant="outline"
          size="sm"
          @click="router.push('/dashboard/combos')"
          ><ArrowLeft class="size-4" />Combos</Button
        ><Button
          size="sm"
          :disabled="!dirty || save.isPending.value"
          @click="save.mutate()"
          ><Save class="size-4" />{{
            save.isPending.value ? "Saving..." : "Save"
          }}</Button
        ></template
      >
    </PageHeader>

    <Card class="p-5">
      <div class="flex items-start gap-3">
        <div
          class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"
        >
          <KeyRound class="size-4" />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium">API key access</p>
          <p class="mt-1 text-xs text-muted-foreground">
            Checked keys may use this combo. Changes apply after you save.
          </p>
        </div>
      </div>
    </Card>

    <Card v-if="keys.isPending.value" class="space-y-2 p-5">
      <div
        v-for="item in 4"
        :key="item"
        class="h-12 animate-pulse rounded-lg bg-muted"
      />
    </Card>
    <EmptyState
      v-else-if="!keys.data.value?.length"
      title="No API keys"
      description="Create an API key before assigning combo access."
      ><Button size="sm" @click="router.push('/dashboard/endpoint')"
        ><KeyRound class="size-4" />Manage keys</Button
      ></EmptyState
    >
    <Card v-else class="p-0">
      <div class="divide-y">
        <label
          v-for="key in keys.data.value"
          :key="key.id"
          class="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          :class="key.isActive === false ? 'opacity-60' : ''"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="truncate text-sm font-medium">{{
                key.name || "Unnamed key"
              }}</span>
              <Badge v-if="key.visibility === 'public'" variant="info"
                >Public</Badge
              >
              <Badge v-else variant="secondary">Private</Badge>
              <Badge v-if="key.isActive === false" variant="warning"
                >Paused</Badge
              >
            </div>
            <p class="mt-0.5 text-[11px] text-muted-foreground">
              {{ key.keyPrefix || "No prefix" }} · {{ modeLabel(key) }}
            </p>
          </div>
          <input
            type="checkbox"
            class="size-4 shrink-0 accent-primary"
            :checked="checked.has(key.id)"
            @change="toggle(key.id)"
          />
        </label>
      </div>
    </Card>
  </div>
</template>
