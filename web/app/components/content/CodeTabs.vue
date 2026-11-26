<script setup lang="ts">
import type { VNode } from 'vue';
import type { CodeExample } from '~/lib/docsCode';

defineSlots<{ default?: () => VNode[] }>();

function examplesIn(nodes: VNode[]): CodeExample[] {
  return nodes.flatMap((node) => {
    const props: unknown = node.props;
    if (typeof props !== 'object' || props === null) return [];
    if (!('code' in props) || typeof props.code !== 'string') return [];
    const language =
      'language' in props && typeof props.language === 'string' ? props.language : '';
    return [{ language, code: props.code }];
  });
}
</script>

<template>
  <DocsCodeBlock :examples="examplesIn($slots.default?.() ?? [])" />
</template>
