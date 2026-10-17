<script setup lang="ts">
import { CheckCircle2, CircleAlert, Info, X } from "lucide-vue-next";
import { useNotificationStore } from "@/stores/notifications";
import { cn } from "@/lib/utils";

const notifications = useNotificationStore();
const icons = { success: CheckCircle2, error: CircleAlert, info: Info };
</script>

<template>
  <div
    class="fixed right-4 top-4 z-[80] flex w-[min(92vw,calc(100vw-2rem))] max-w-[380px] flex-col gap-2"
  >
    <div
      v-for="notice in notifications.notices"
      :key="notice.id"
      :class="
        cn(
          'flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm shadow-lg',
          notice.type === 'success' && 'border-success/25 text-success',
          notice.type === 'error' && 'border-destructive/25 text-destructive',
          notice.type === 'info' && 'border-primary/25 text-primary',
        )
      "
      role="status"
    >
      <component :is="icons[notice.type]" class="mt-0.5 size-4 shrink-0" />
      <div class="min-w-0 flex-1">
        <p v-if="notice.title" class="break-words font-semibold">
          {{ notice.title }}
        </p>
        <p class="break-words text-foreground/80">{{ notice.message }}</p>
      </div>
      <button
        class="text-muted-foreground hover:text-foreground"
        aria-label="Dismiss notification"
        @click="notifications.remove(notice.id)"
      >
        <X class="size-4" />
      </button>
    </div>
  </div>
</template>
