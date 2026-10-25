<script setup lang="ts">
import { CheckCircle2, X } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import ProviderLogo from "@/components/app/ProviderLogo.vue";
import Badge from "@/components/ui/badge.vue";
import Skeleton from "@/components/ui/skeleton.vue";

export type ProviderListStatus = {
  total: number;
  good: number;
  bad: number;
  disabled: boolean;
};

// One provider in the Providers list. Built-in and custom providers share it.
// A custom provider passes `logo` and leaves `provider` unset, so a missing
// logo falls back to initials instead of a bundled asset lookup.
const props = defineProps<{
  id: string;
  name: string;
  provider?: string;
  logo?: string | null;
  status: ProviderListStatus;
  loading: boolean;
  directory: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <RouterLink
    v-if="props.directory"
    :to="`/dashboard/providers/${props.id}`"
    class="group flex h-11 items-center gap-2.5 rounded-lg border bg-card px-3 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :class="{ 'opacity-55': status.disabled }"
    ><ProviderLogo
      :provider="props.provider"
      :src="props.logo || undefined"
      :label="name"
      size="size-6"
    /><span class="min-w-0 flex-1 truncate text-sm font-medium">{{
      name
    }}</span
    ><button
      v-if="status.total"
      type="button"
      class="hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent group-focus-within:grid group-hover:grid"
      :title="status.disabled ? 'Enable provider' : 'Disable provider'"
      :aria-label="status.disabled ? `Enable ${name}` : `Disable ${name}`"
      @click.prevent.stop="emit('toggle')"
    >
      <CheckCircle2
        class="size-4"
        :class="status.disabled ? 'text-muted-foreground' : 'text-success'"
      /></button
    ><span class="flex shrink-0 items-center gap-2 text-xs tabular-nums"
      ><Skeleton v-if="loading" class="h-3 w-6" /><span
        v-else-if="status.disabled"
        class="inline-flex items-center gap-1 text-muted-foreground"
        title="Disabled"
        ><span
          class="size-1.5 rounded-full border border-current"
          aria-hidden="true"
        /><span class="sr-only">Disabled</span></span
      ><template v-else-if="status.total"
        ><span
          v-if="status.good"
          class="inline-flex items-center gap-1 text-success"
          :title="`${status.good} connected`"
          ><span
            class="size-1.5 rounded-full bg-success"
            aria-hidden="true"
          />{{ status.good }}<span class="sr-only"> connected</span></span
        ><span
          v-if="status.bad"
          class="inline-flex items-center gap-0.5 text-destructive"
          :title="`${status.bad} error`"
          ><X class="size-2.5" aria-hidden="true" />{{ status.bad
          }}<span class="sr-only"> error</span></span
        ></template
      ><span v-else class="text-muted-foreground" title="No connections"
        ><span aria-hidden="true">–</span
        ><span class="sr-only">No connections</span></span
      ></span
    ></RouterLink
  >
  <RouterLink
    v-else
    :to="`/dashboard/providers/${props.id}`"
    class="group rounded-[10px] border bg-card p-[15px] transition-colors hover:border-primary"
    :class="{ 'opacity-55': status.disabled }"
    ><div class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <ProviderLogo
          :provider="props.provider"
          :src="props.logo || undefined"
          :label="name"
        />
        <div class="min-w-0">
          <p class="truncate font-medium">{{ name }}</p>
          <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge
              v-if="status.disabled"
              variant="secondary"
              class="rounded-[5px]"
              >Disabled</Badge
            ><template v-else
              ><Badge
                v-if="status.good"
                variant="success"
                class="rounded-[5px]"
                >{{ status.good }} connected</Badge
              ><Badge
                v-if="status.bad"
                variant="destructive"
                class="rounded-[5px]"
                >{{ status.bad }} error</Badge
              ><Skeleton v-if="loading" class="h-4 w-20" /><span
                v-else-if="!status.total"
                class="text-muted-foreground"
                >No connections</span
              ></template
            >
          </div>
        </div>
      </div>
      <button
        v-if="status.total"
        type="button"
        class="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100"
        :title="status.disabled ? 'Enable provider' : 'Disable provider'"
        :aria-label="status.disabled ? `Enable ${name}` : `Disable ${name}`"
        @click.prevent.stop="emit('toggle')"
      >
        <CheckCircle2
          class="size-4"
          :class="status.disabled ? 'text-muted-foreground' : 'text-success'"
        />
      </button></div
  ></RouterLink>
</template>
