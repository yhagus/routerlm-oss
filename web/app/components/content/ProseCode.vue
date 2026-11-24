<script setup lang="ts">
import type { VNode } from "vue";

defineSlots<{ default?: () => VNode[] }>();

const { withGatewayUrl } = useGatewayUrl();

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
