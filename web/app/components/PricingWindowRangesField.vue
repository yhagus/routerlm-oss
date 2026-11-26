<script setup lang="ts">
import { CalendarRange, Plus, Trash2 } from '@lucide/vue';
import {
  ALWAYS_RANGE,
  END_TIME_PATTERN,
  ISO_WEEKDAYS,
  type IsoWeekday,
  type RangeForm,
  rangeFormFor,
  START_TIME_PATTERN,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT_NAMES,
} from '~/lib/pricingWindows';

const ranges = defineModel<RangeForm[]>({ required: true });

function rangeName(index: number): string {
  return `range ${index + 1}`;
}

function handleWeekdayToggle(range: RangeForm, day: IsoWeekday): void {
  range.weekdays = range.weekdays.includes(day)
    ? range.weekdays.filter((each) => each !== day)
    : [...range.weekdays, day];
}

function handleAdd(): void {
  ranges.value.push(rangeFormFor());
}

function handleAlways(): void {
  ranges.value = [rangeFormFor(ALWAYS_RANGE)];
}

function handleRemove(range: RangeForm): void {
  ranges.value = ranges.value.filter((row) => row.key !== range.key);
}
</script>

<template>
  <fieldset class="range-list">
    <legend class="field__label">Ranges</legend>
    <div class="range-list__head" aria-hidden="true">
      <span class="field__label">Weekdays</span>
      <span class="field__label">Start</span>
      <span class="field__label">End</span>
    </div>
    <div v-for="(range, index) in ranges" :key="range.key" class="range-list__row">
      <div
        class="segmented range-list__weekdays"
        role="group"
        :aria-label="`Weekdays of ${rangeName(index)}`"
      >
        <button
          v-for="day in ISO_WEEKDAYS"
          :key="day"
          class="segmented__option range-list__weekday"
          type="button"
          :aria-pressed="range.weekdays.includes(day)"
          :aria-label="WEEKDAY_NAMES[day]"
          @click="handleWeekdayToggle(range, day)"
        >
          {{ WEEKDAY_SHORT_NAMES[day] }}
        </button>
      </div>
      <input
        v-model="range.start"
        class="text-input tabular"
        inputmode="numeric"
        placeholder="HH:MM"
        required
        :pattern="START_TIME_PATTERN"
        title="A time from 00:00 to 23:59"
        :aria-label="`Start of ${rangeName(index)}`"
      />
      <input
        v-model="range.end"
        class="text-input tabular"
        inputmode="numeric"
        placeholder="HH:MM"
        required
        :pattern="END_TIME_PATTERN"
        title="A time from 00:00 to 23:59, or 24:00 for the end of the day"
        :aria-label="`End of ${rangeName(index)}`"
      />
      <button
        class="icon-button range-list__remove"
        type="button"
        :aria-label="`Remove ${rangeName(index)}`"
        :disabled="ranges.length === 1"
        @click="handleRemove(range)"
      >
        <Trash2 :size="14" />
      </button>
    </div>
    <p class="form__hint">
      An end before the start crosses midnight and belongs to the day it starts on. Use 24:00 to run
      to the end of the day.
    </p>
    <div class="range-list__actions">
      <button class="button" type="button" @click="handleAdd"><Plus :size="14" /> Add range</button>
      <button
        class="button"
        type="button"
        title="Replace the ranges with every weekday, 00:00 to 24:00"
        @click="handleAlways"
      >
        <CalendarRange :size="14" /> Always
      </button>
    </div>
  </fieldset>
</template>
