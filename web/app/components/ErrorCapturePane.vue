<script setup lang="ts">
import { Check, Copy } from "@lucide/vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { computed, ref, useTemplateRef } from "vue";
import { copyShortcut, useCopyFeedback } from "~/composables/useCopyFeedback";
import { readableBody } from "~/lib/errorCaptures";

/**
 * One captured message, the client's request or the upstream's response: its
 * body first, its headers a tab away, and a button that copies what is shown.
 */
const props = defineProps<{
  title: string;
  description: string;
  headers: Record<string, string>;
  body: string;
}>();

type Tab = "body" | "headers";
const tab = ref<Tab>("body");
const { state, copy } = useCopyFeedback();
const bodyElement = useTemplateRef<HTMLElement>("bodyElement");
const headersElement = useTemplateRef<HTMLElement>("headersElement");

const headerEntries = computed(() => Object.entries(props.headers));
const bodyText = computed(() => readableBody(props.body));
const headersText = computed(() =>
  headerEntries.value.map(([name, value]) => `${name}: ${value}`).join("\n"),
);
const isShownEmpty = computed(() =>
  tab.value === "body" ? props.body.trim() === "" : headerEntries.value.length === 0,
);
const copyLabel = computed(() => (tab.value === "body" ? "Copy body" : "Copy headers"));
/** What the button says: its result for a moment after a click, "Copy" otherwise. */
const copyText = computed(() => {
  if (state.value === "copied") return "Copied";
  if (state.value === "failed") return "Couldn't copy";
  if (state.value === "manual") return `Press ${copyShortcut()}`;
  return "Copy";
});

/** When the clipboard refuses, the shown text is selected so the reader can copy it by key. */
function copyShown(): void {
  const isBody = tab.value === "body";
  void copy(
    isBody ? bodyText.value : headersText.value,
    isBody ? bodyElement.value : headersElement.value,
  );
}
</script>

<template>
  <section class="panel capture-pane">
    <TabsRoot v-model="tab" class="capture-pane__tabs">
      <header class="capture-pane__head">
        <div class="capture-pane__title">
          <h2>{{ title }}</h2>
          <p>{{ description }}</p>
        </div>
        <div class="capture-pane__tools">
          <TabsList class="segmented" :aria-label="`${title} view`">
            <TabsTrigger class="segmented__option" value="body">Body</TabsTrigger>
            <TabsTrigger class="segmented__option" value="headers">
              Headers <span class="capture-pane__count tabular">{{ headerEntries.length }}</span>
            </TabsTrigger>
          </TabsList>
          <button
            class="capture-pane__copy"
            type="button"
            :aria-label="copyLabel"
            :disabled="isShownEmpty"
            @click="copyShown"
          >
            <Check v-if="state === 'copied'" :size="13" aria-hidden="true" />
            <Copy v-else :size="13" aria-hidden="true" />
            <span aria-hidden="true">{{ copyText }}</span>
            <span class="sr-only" aria-live="polite">{{ state === "idle" ? "" : copyText }}</span>
          </button>
        </div>
      </header>
      <TabsContent value="body" class="capture-pane__content">
        <pre
          v-if="body.trim() !== ''"
          ref="bodyElement"
          class="capture-body"
          role="region"
          :aria-label="`${title} body`"
          tabindex="0"
          >{{ bodyText }}</pre>
        <p v-else class="capture-pane__empty">Empty body.</p>
      </TabsContent>
      <TabsContent value="headers" class="capture-pane__content">
        <dl
          v-if="headerEntries.length > 0"
          ref="headersElement"
          class="capture-headers"
          role="region"
          :aria-label="`${title} headers`"
          tabindex="0"
        >
          <div v-for="[name, value] in headerEntries" :key="name">
            <dt>{{ name }}</dt>
            <dd>{{ value }}</dd>
          </div>
        </dl>
        <p v-else class="capture-pane__empty">No headers.</p>
      </TabsContent>
    </TabsRoot>
  </section>
</template>
