<script setup lang="ts">
import { computed } from 'vue';
import { holderLabel, holderLink, type WaitingHolder } from '~/lib/waitingRequests';

const props = defineProps<{ holder: WaitingHolder }>();

const label = computed(() => holderLabel(props.holder));
const link = computed(() => holderLink(props.holder));
</script>

<template>
  <NuxtLink v-if="link" :to="link">{{ label }}</NuxtLink>
  <span v-else>{{ label }}</span>
</template>
