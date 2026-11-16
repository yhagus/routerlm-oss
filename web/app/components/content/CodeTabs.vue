<script setup lang="ts">
import type { VNode } from "vue";
import type { CodeExample } from "~/lib/docsCode";

/**
 * `::code-tabs` in the docs Markdown: the fenced blocks inside it are one
 * example in several languages, shown as tabs of a single code block.
 */
defineSlots<{ default?: () => VNode[] }>();

/** The fenced blocks among the slot's nodes, read from the props MDC gives ProsePre. */
function examplesIn(nodes: VNode[]): CodeExample[] {
  return nodes.flatMap((node) => {
    const props: unknown = node.props;
    if (typeof props !== "object" || props === null) return [];
    if (!("code" in props) || typeof props.code !== "string") return [];
    const language =
      "language" in props && typeof props.language === "string" ? props.language : "";
    return [{ language, code: props.code }];
  });
}
</script>

<template>
  <DocsCodeBlock :examples="examplesIn($slots.default?.() ?? [])" />
</template>
