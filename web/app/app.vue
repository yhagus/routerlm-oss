<script setup lang="ts">
useHead({ titleTemplate: (title) => (title ? `${title} · RouterLM` : "RouterLM") });
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
