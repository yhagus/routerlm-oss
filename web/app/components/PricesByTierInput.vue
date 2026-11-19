<script setup lang="ts">
import type { TierPriceForm } from "~/lib/upstreamModelMedia";

/**
 * Prices that depend on a tier the Provider names, such as an image size
 * (`2K`) or a video resolution (`720P`): the tiers are typed as tags, then
 * each gets its own price.
 */
defineProps<{
  /** What a tier is, such as "Size tier"; names the tag field and each price. */
  tierLabel: string;
  /** The unit after the price, such as "/ image". */
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
