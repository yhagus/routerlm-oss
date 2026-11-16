<script setup lang="ts">
// The English and Indonesian docs share one page; DocsPage reads the language from the address.
// The datasheet turns pages without the dashboard's fade-and-rise.
definePageMeta({ layout: "docs", pageTransition: false });
</script>

<template>
  <DocsPage />
</template>
