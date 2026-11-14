<script setup lang="ts">
defineProps<{ title: string; description: string }>();
</script>

<template>
  <section class="page-heading">
    <div>
      <h1>{{ title }}</h1>
      <p class="page-heading__sub">{{ description }}</p>
    </div>
    <div v-if="$slots.default" class="page-heading__controls"><slot /></div>
  </section>
</template>
