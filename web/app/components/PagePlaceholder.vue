<script setup lang="ts">
import { Construction } from '@lucide/vue';

const props = defineProps<{ title: string; description: string }>();
useHead({ title: props.title });
</script>

<template>
  <PageHeading :title="title" :description="description" />
  <section class="panel">
    <EmptyState :icon="Construction">
      <strong>{{ title }} isn't available yet.</strong
      ><span>This screen is still being built.</span>
    </EmptyState>
  </section>
</template>
