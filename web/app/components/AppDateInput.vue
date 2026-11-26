<script setup lang="ts">
import { type DateValue, getLocalTimeZone, parseDate, today } from '@internationalized/date';
import { CalendarDays, ChevronLeft, ChevronRight, X } from '@lucide/vue';
import {
  DatePickerCalendar,
  DatePickerCell,
  DatePickerCellTrigger,
  DatePickerContent,
  DatePickerField,
  DatePickerGrid,
  DatePickerGridBody,
  DatePickerGridHead,
  DatePickerGridRow,
  DatePickerHeadCell,
  DatePickerHeader,
  DatePickerHeading,
  DatePickerInput,
  DatePickerNext,
  DatePickerPrev,
  DatePickerRoot,
  DatePickerTrigger,
} from 'reka-ui';

const props = defineProps<{
  label: string;
  min?: string;
}>();
const model = defineModel<string>({ required: true });
const open = ref(false);

const LOCALE = 'en-CA';

const dateValue = computed<DateValue | undefined>({
  get: () => {
    if (!model.value) return undefined;
    try {
      return parseDate(model.value);
    } catch {
      return undefined;
    }
  },
  set: (value) => {
    model.value = value ? value.toString() : '';
  },
});

const minValue = computed<DateValue | undefined>(() => {
  if (!props.min) return undefined;
  try {
    return parseDate(props.min);
  } catch {
    return undefined;
  }
});

function pickToday() {
  dateValue.value = today(getLocalTimeZone());
  open.value = false;
}
function clear() {
  model.value = '';
  open.value = false;
}
</script>

<template>
  <DatePickerRoot
    v-model="dateValue"
    v-model:open="open"
    :locale="LOCALE"
    :min-value="minValue"
    granularity="day"
    :week-starts-on="1"
    weekday-format="short"
    fixed-weeks
    close-on-select
  >
    <DatePickerField v-slot="{ segments }" class="date-input" :aria-label="label">
      <div class="date-input__segments">
        <template v-for="item in segments" :key="item.part">
          <DatePickerInput
            v-if="item.part === 'literal'"
            :part="item.part"
            class="date-input__literal"
          >
            {{ item.value }}
          </DatePickerInput>
          <DatePickerInput v-else :part="item.part" class="date-input__segment">
            {{ item.value }}
          </DatePickerInput>
        </template>
      </div>
      <button
        v-if="model"
        type="button"
        class="date-input__icon-button"
        :aria-label="`Clear ${label}`"
        @click="clear"
      >
        <X :size="13" />
      </button>
      <DatePickerTrigger class="date-input__icon-button" :aria-label="`Choose ${label}`">
        <CalendarDays :size="14" />
      </DatePickerTrigger>
    </DatePickerField>

    <DatePickerContent class="date-popover" align="end" :side-offset="6" :collision-padding="12">
      <DatePickerCalendar v-slot="{ weekDays, grid }" class="date-calendar">
        <DatePickerHeader class="date-calendar__header">
          <DatePickerPrev class="date-calendar__nav" aria-label="Previous month">
            <ChevronLeft :size="15" />
          </DatePickerPrev>
          <DatePickerHeading class="date-calendar__heading" />
          <DatePickerNext class="date-calendar__nav" aria-label="Next month">
            <ChevronRight :size="15" />
          </DatePickerNext>
        </DatePickerHeader>

        <DatePickerGrid
          v-for="month in grid"
          :key="month.value.toString()"
          class="date-calendar__grid"
        >
          <DatePickerGridHead>
            <DatePickerGridRow class="date-calendar__row">
              <DatePickerHeadCell v-for="day in weekDays" :key="day" class="date-calendar__weekday">
                {{ day.slice(0, 2) }}
              </DatePickerHeadCell>
            </DatePickerGridRow>
          </DatePickerGridHead>
          <DatePickerGridBody>
            <DatePickerGridRow
              v-for="(week, index) in month.rows"
              :key="`week-${index}`"
              class="date-calendar__row"
            >
              <DatePickerCell
                v-for="day in week"
                :key="day.toString()"
                :date="day"
                class="date-calendar__cell"
              >
                <DatePickerCellTrigger :day="day" :month="month.value" class="date-calendar__day" />
              </DatePickerCell>
            </DatePickerGridRow>
          </DatePickerGridBody>
        </DatePickerGrid>
      </DatePickerCalendar>

      <div class="date-popover__footer">
        <button type="button" class="date-popover__action" @click="pickToday">Today</button>
        <button v-if="model" type="button" class="date-popover__action" @click="clear">
          Clear
        </button>
      </div>
    </DatePickerContent>
  </DatePickerRoot>
</template>
