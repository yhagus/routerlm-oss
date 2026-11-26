<script setup lang="ts">
import {
  formatNumberInput,
  GROUP_SEPARATOR,
  parseNumberInput,
  positionAfterSignificantChars,
  significantCharsBefore,
} from '~/lib/numberInput';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    whole?: boolean;
    min?: number;
    max?: number;
    tokens?: boolean;
    prefix?: string;
    suffix?: string;
    unitLabel?: string;
  }>(),
  {
    whole: false,
    min: undefined,
    max: undefined,
    tokens: false,
    prefix: '',
    suffix: '',
    unitLabel: '',
  },
);
const unitId = useId();
const model = defineModel<string | number>({ required: true });

const input = useTemplateRef<HTMLInputElement>('input');
const rules = computed(() => ({ isWhole: props.whole, allowsShorthand: props.tokens }));

const value = computed(() =>
  model.value === '' ? '' : parseNumberInput(String(model.value), rules.value),
);
const shown = computed(() => formatNumberInput(value.value));

const compactTokens = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});
const tokenNote = computed(() => {
  const amount = Number(value.value);
  return props.tokens && value.value !== '' && Number.isFinite(amount) && amount >= 1000
    ? `${compactTokens.format(amount)} tokens`
    : '';
});
const note = computed(() => tokenNote.value || props.suffix);

function problemWith(text: string): string {
  if (text === '') return '';
  const amount = Number(text);
  if (!Number.isFinite(amount)) return 'Enter a number.';
  if (props.whole && !Number.isInteger(amount)) return 'Enter a whole number.';
  if (props.min !== undefined && amount < props.min) {
    return `Enter ${formatNumberInput(String(props.min))} or more.`;
  }
  if (props.max !== undefined && amount > props.max) {
    return `Enter ${formatNumberInput(String(props.max))} or less.`;
  }
  return '';
}

function syncValidity(): void {
  input.value?.setCustomValidity(problemWith(value.value));
}

function onInput(event: Event): void {
  const field = event.target;
  if (!(field instanceof HTMLInputElement)) return;
  const typed = field.value;
  const caret = field.selectionStart ?? typed.length;
  const next = parseNumberInput(typed, rules.value);
  const display = formatNumberInput(next);
  field.value = display;
  const expandedShorthand = props.tokens && /[km]\s*$/i.test(typed);
  const nextCaret = expandedShorthand
    ? display.length
    : positionAfterSignificantChars(display, significantCharsBefore(typed, caret));
  field.setSelectionRange(nextCaret, nextCaret);
  model.value = next;
  field.setCustomValidity(problemWith(next));
}

function onBeforeInput(event: InputEvent): void {
  const field = event.target;
  if (!(field instanceof HTMLInputElement)) return;
  const { selectionStart: start, selectionEnd: end, value: text } = field;
  if (start === null || start !== end) return;
  if (event.inputType === 'deleteContentBackward' && text.charAt(start - 1) === GROUP_SEPARATOR) {
    field.setSelectionRange(start - 1, start - 1);
  }
  if (event.inputType === 'deleteContentForward' && text.charAt(start) === GROUP_SEPARATOR) {
    field.setSelectionRange(start + 1, start + 1);
  }
}

onMounted(syncValidity);
watch(value, syncValidity, { flush: 'post' });
</script>

<template>
  <span
    class="number-input"
    :class="{ 'number-input--noted': note, 'number-input--prefixed': prefix }"
  >
    <span v-if="prefix" class="number-input__prefix" aria-hidden="true">{{ prefix }}</span>
    <input
      ref="input"
      v-bind="$attrs"
      type="text"
      :inputmode="whole ? 'numeric' : 'decimal'"
      autocomplete="off"
      spellcheck="false"
      :value="shown"
      :aria-describedby="unitLabel ? unitId : undefined"
      @beforeinput="onBeforeInput"
      @input="onInput"
    />
    <span v-if="note" class="number-input__note" aria-hidden="true">{{ note }}</span>
    <span v-if="unitLabel" :id="unitId" class="sr-only">{{ unitLabel }}</span>
  </span>
</template>
