<script setup lang="ts">
import EmptyState from "@/components/app/EmptyState.vue";
import Skeleton from "@/components/ui/skeleton.vue";

withDefaults(
  defineProps<{
    loading?: boolean;
    empty?: boolean;
    emptyTitle: string;
    emptyDescription: string;
    columns: string[];
  }>(),
  { loading: false, empty: false },
);
</script>

<template>
  <div class="overflow-hidden rounded-lg border bg-card">
    <div v-if="loading" role="status" aria-label="Loading">
      <div class="h-8 border-b bg-muted/60" />
      <div
        v-for="index in 5"
        :key="index"
        class="flex items-center gap-5 border-b border-border/60 px-3.75 py-2.5 last:border-b-0"
      >
        <Skeleton
          v-for="column in Math.max(columns.length, 1)"
          :key="column"
          class="h-3.5 flex-1"
        />
      </div>
    </div>
    <EmptyState
      v-else-if="empty"
      :title="emptyTitle"
      :description="emptyDescription"
      ><slot name="empty"
    /></EmptyState>
    <div v-else class="overflow-x-auto">
      <table class="w-full min-w-[640px] text-left text-sm">
        <thead class="border-b bg-muted/60 text-[11px] text-muted-foreground">
          <tr>
            <th
              v-for="column in columns"
              :key="column"
              class="font-semibold px-5 py-2.5"
            >
              {{ column }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/60">
          <slot />
        </tbody>
      </table>
    </div>
  </div>
</template>
