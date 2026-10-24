<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import Button from "@/components/ui/button.vue";
import { changelogSection, parseChangelog } from "@/lib/changelog";
// Bundled at build time so the dialog matches the running version offline.
import content from "../../../../CHANGELOG.md?raw";

const props = defineProps<{ open: boolean; version?: string | null }>();
const emit = defineEmits<{ close: [] }>();

const sections = parseChangelog(content);
const showAll = ref(false);
const focused = computed(() => changelogSection(sections, props.version));

// Each opening starts on the requested version again.
watch(
  () => props.open,
  (open) => {
    if (open) showAll.value = false;
  },
);
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[70] grid place-items-center p-4"
    data-i18n-skip="true"
  >
    <button
      class="absolute inset-0 bg-black/40 backdrop-blur-sm"
      aria-label="Close changelog"
      @click="emit('close')"
    />
    <section
      class="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Change Log"
    >
      <header
        class="flex items-center justify-between gap-3 border-b border-border px-4 py-3"
      >
        <h2 class="truncate text-lg font-semibold">
          <template v-if="focused && !showAll"
            >What's new in v{{ focused.version }}</template
          >
          <template v-else>Change Log</template>
        </h2>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            v-if="focused"
            variant="ghost"
            size="sm"
            @click="showAll = !showAll"
            >{{
              showAll ? `Only v${focused.version}` : "Show all versions"
            }}</Button
          >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close changelog"
            @click="emit('close')"
            ><X class="size-4"
          /></Button>
        </div>
      </header>
      <div class="min-h-36 overflow-y-auto p-6">
        <template v-if="focused && !showAll">
          <p v-if="focused.date" class="mb-3 text-xs text-muted-foreground">
            Released {{ focused.date }}
          </p>
          <pre
            class="whitespace-pre-wrap break-words font-sans text-sm leading-6"
            >{{ focused.body }}</pre>
        </template>
        <pre
          v-else
          class="whitespace-pre-wrap break-words font-sans text-sm leading-6"
          >{{ content }}</pre>
      </div>
    </section>
  </div>
</template>
