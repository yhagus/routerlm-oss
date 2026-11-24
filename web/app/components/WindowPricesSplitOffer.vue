<script setup lang="ts">
import { formatValidityPeriod } from "~/lib/validityPeriods";
import { type AttachedWindowForm, validityPeriodOf } from "~/lib/windowPricesForm";

defineProps<{
  entries: readonly AttachedWindowForm[];
  isSaving: boolean;
}>();
const emit = defineEmits<{ accept: []; decline: [] }>();
</script>

<template>
  <section class="split-offer" aria-labelledby="split-offer-title">
    <h3 id="split-offer-title" class="split-offer__title">Split the open-ended Window Prices?</h3>
    <p class="form__hint">
      A new Validity Period collides with Window Prices that have no start or no end. Splitting ends
      them where the new period starts and attaches them again, with the same prices, from where it
      ends. These attachments will be saved:
    </p>
    <ol class="split-offer__list">
      <li v-for="entry in entries" :key="entry.key">
        <strong>{{ entry.name }}</strong>
        <span class="tabular">{{ formatValidityPeriod(validityPeriodOf(entry)) }}</span>
        <span class="split-offer__zone">({{ entry.timeZone }})</span>
      </li>
    </ol>
    <div class="dialog__actions">
      <button class="button" type="button" @click="emit('decline')">Keep editing</button>
      <button
        class="button button--primary"
        type="button"
        :disabled="isSaving"
        @click="emit('accept')"
      >
        Split and save
      </button>
    </div>
  </section>
</template>
