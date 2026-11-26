<script setup lang="ts">
import { Sparkles, X } from '@lucide/vue';
import { computed } from 'vue';
import { describeCatalogGap, MAX_LISTED_GAPS } from '~/lib/catalogGaps';

const { gaps, checkOncePerSession, dismiss } = useCatalogGaps();

const listedGaps = computed(() => gaps.value.slice(0, MAX_LISTED_GAPS));
const hiddenCount = computed(() => gaps.value.length - listedGaps.value.length);
const title = computed(() =>
  gaps.value.length === 1
    ? '1 new model not in your Catalog'
    : `${gaps.value.length} new models not in your Catalog`,
);

onMounted(checkOncePerSession);
</script>

<template>
  <aside v-if="gaps.length" class="toast catalog-gaps-notice" aria-label="New models">
    <Sparkles :size="16" />
    <div class="catalog-gaps-notice__body">
      <strong>{{ title }}</strong>
      <ul>
        <li v-for="gap in listedGaps" :key="`${gap.providerSlug}/${gap.upstreamModelId}`">
          {{ describeCatalogGap(gap) }}
        </li>
      </ul>
      <small v-if="hiddenCount > 0">and {{ hiddenCount }} more</small>
    </div>
    <button class="icon-button" aria-label="Dismiss" @click="dismiss"><X :size="15" /></button>
  </aside>
</template>
