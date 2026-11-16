<script setup lang="ts">
import type { VNode } from "vue";

/** Inline code in the docs, with the real gateway URL in place of the placeholder. */
defineSlots<{ default?: () => VNode[] }>();

const { withGatewayUrl } = useGatewayUrl();

/** The slot's text with the real gateway URL, or null when it holds more than plain text. */
function displayedTextOf(nodes: VNode[]): string | null {
  let text = "";
  for (const node of nodes) {
    if (typeof node.children !== "string") return null;
    text += node.children;
  }
  return withGatewayUrl(text);
}
</script>

<template>
  <code v-if="displayedTextOf($slots.default?.() ?? []) === null"><slot /></code>
  <code v-else>{{ displayedTextOf($slots.default?.() ?? []) }}</code>
</template>
