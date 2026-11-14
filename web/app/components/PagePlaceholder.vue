<script setup lang="ts">
// A dashboard page whose screen hasn't been built yet.
const props = defineProps<{ title: string; description: string }>();
useHead({ title: props.title });
</script>

<template>
  <PageHeading :title="title" :description="description" />
  <section class="panel">
    <div class="empty-state">
      <strong>{{ title }} isn't available yet.</strong
      ><span>This screen is still being built.</span>
    </div>
  </section>
</template>
