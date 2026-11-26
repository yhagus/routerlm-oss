<script setup lang="ts">
import type { TierPriceForm } from '~/lib/upstreamModelMedia';

defineProps<{
  tierLabel: string;
  suffix: string;
  unitLabel: string;
}>();
const form = defineModel<TierPriceForm>({ required: true });
</script>

<template>
  <div class="field">
    <span class="field__label">{{ tierLabel }}s</span>
    <TagListInput v-model="form.tiers" :label="`${tierLabel}s`" placeholder="Tier, then Enter" />
  </div>
  <div v-if="form.tiers.length > 0" class="form__grid">
    <label v-for="tier in form.tiers" :key="tier" class="field"
      ><span class="field__label">{{ tierLabel }} {{ tier }} price</span
      ><NumberInput
        :model-value="form.prices[tier] ?? ''"
        class="text-input"
        :min="0"
        prefix="$"
        :suffix="suffix"
        :unit-label="unitLabel"
        @update:model-value="form.prices[tier] = $event"
    /></label>
  </div>
</template>
