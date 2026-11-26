<script setup lang="ts">
import { Unlink } from '@lucide/vue';
import { apiErrorMessage } from '~/lib/api';
import {
  formatWindowPriceChange,
  type PricingWindow,
  WINDOW_PRICE_FIELDS,
  WINDOW_PRICES_STATUS_BADGES,
  type WindowPrices,
  type WindowPricesStatus,
} from '~/lib/pricingWindows';
import { optionalNumber, type UpstreamModel, upstreamModelLabel } from '~/lib/upstream';
import {
  type AttachedWindowForm,
  attachedWindowFormOf,
  emptyPeriodEntryOf,
  newAttachedWindowForm,
  splitOpenEndedAround,
  windowPricesBody,
} from '~/lib/windowPricesForm';

const props = defineProps<{
  upstreamModel: UpstreamModel;
  refresh: () => Promise<unknown>;
}>();
const isOpen = defineModel<boolean>('open', { required: true });

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const { data: pricingWindows, status } = useDashboardApi<PricingWindow[]>('/pricing-windows');

const attached = ref<AttachedWindowForm[]>(
  props.upstreamModel.pricingWindows.map(attachedWindowFormOf),
);
const splitOffer = shallowRef<AttachedWindowForm[]>();
const isSaving = ref(false);
const saveError = ref('');

const title = computed(() => `Pricing Windows of ${upstreamModelLabel(props.upstreamModel)}`);

const attachOptions = computed(() =>
  (pricingWindows.value ?? []).map((entry) => ({
    label: entry.isEnabled ? entry.name : `${entry.name} (disabled)`,
    value: entry.id,
  })),
);
const attachPlaceholder = computed(() => {
  if (status.value === 'pending') return 'Loading Pricing Windows…';
  return attachOptions.value.length > 0 ? 'Attach a Pricing Window' : 'No Pricing Windows yet';
});

function standardPlaceholder(key: keyof WindowPrices): string {
  const standard = props.upstreamModel[key];
  return standard === null ? 'Standard (none)' : `${standard} (standard)`;
}

function priceChange(entry: AttachedWindowForm, key: keyof WindowPrices): string | undefined {
  const price = optionalNumber(entry.prices[key]);
  if (price !== null && !Number.isFinite(price)) return undefined;
  return formatWindowPriceChange(price, props.upstreamModel[key]);
}

function statusBadgeClass(entryStatus: WindowPricesStatus): string[] {
  const { tone } = WINDOW_PRICES_STATUS_BADGES[entryStatus];
  return tone === 'neutral' ? ['status-badge'] : ['status-badge', `status-badge--${tone}`];
}

function handleAttach(pricingWindowId: string): void {
  const entry = pricingWindows.value?.find((each) => each.id === pricingWindowId);
  if (entry) attached.value.push(newAttachedWindowForm(entry));
}

function handleDetach(key: number): void {
  attached.value = attached.value.filter((each) => each.key !== key);
}

function handleSave(): void {
  saveError.value = '';
  const emptyPeriodEntry = emptyPeriodEntryOf(attached.value);
  if (emptyPeriodEntry) {
    saveError.value = `${emptyPeriodEntry.name}: the start must be before the end.`;
    return;
  }
  const split = splitOpenEndedAround(attached.value);
  if (split) {
    splitOffer.value = split;
    return;
  }
  void save(attached.value);
}

async function handleAcceptSplit(): Promise<void> {
  const split = splitOffer.value;
  if (!split) return;
  await save(split);
  splitOffer.value = undefined;
}

async function save(entries: readonly AttachedWindowForm[]): Promise<void> {
  isSaving.value = true;
  try {
    await $dashboardApi(`/upstream-models/${props.upstreamModel.id}/pricing-windows`, {
      method: 'PUT',
      body: entries.map(windowPricesBody),
    });
    showToast(`Saved the Pricing Windows of ${upstreamModelLabel(props.upstreamModel)}`);
    isOpen.value = false;
    await props.refresh();
  } catch (error) {
    saveError.value = apiErrorMessage(error, "Couldn't save the Pricing Windows.");
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <AppDialog
    v-model:open="isOpen"
    wide
    :title="title"
    description="At most one attachment may apply at any moment. Leave a price empty to keep the standard one, and a bound empty to leave the Validity Period open."
  >
    <WindowPricesSplitOffer
      v-if="splitOffer"
      :entries="splitOffer"
      :is-saving="isSaving"
      @accept="handleAcceptSplit"
      @decline="splitOffer = undefined"
    />
    <form v-else class="form" @submit.prevent="handleSave">
      <ul v-if="attached.length > 0" class="window-prices">
        <li v-for="entry in attached" :key="entry.key" class="window-prices__item">
          <div class="window-prices__head">
            <strong>{{ entry.name }}</strong>
            <span v-if="!entry.isEnabled" class="status-badge status-badge--warn">Disabled</span>
            <span
              v-if="entry.status"
              :class="statusBadgeClass(entry.status)"
              :title="WINDOW_PRICES_STATUS_BADGES[entry.status].title"
              >{{ WINDOW_PRICES_STATUS_BADGES[entry.status].label }}</span
            >
            <span class="window-prices__actions">
              <button
                class="icon-button"
                type="button"
                :aria-label="`Detach ${entry.name}`"
                title="Detach"
                @click="handleDetach(entry.key)"
              >
                <Unlink :size="14" />
              </button>
            </span>
          </div>
          <div class="form__grid">
            <label class="field"
              ><span class="field__label">Starts ({{ entry.timeZone }})</span
              ><input
                v-model="entry.validFrom"
                class="text-input tabular"
                type="datetime-local"
                :max="entry.validUntil || undefined"
            /></label>
            <label class="field"
              ><span class="field__label">Ends, exclusive ({{ entry.timeZone }})</span
              ><input
                v-model="entry.validUntil"
                class="text-input tabular"
                type="datetime-local"
                :min="entry.validFrom || undefined"
            /></label>
          </div>
          <div class="form__grid">
            <label v-for="field in WINDOW_PRICE_FIELDS" :key="field.key" class="field"
              ><span class="field__label">{{ field.label }}</span
              ><NumberInput
                v-model="entry.prices[field.key]"
                class="text-input"
                :min="0"
                prefix="$"
                suffix="/ 1M tokens"
                unit-label="US dollars per million tokens"
                :placeholder="standardPlaceholder(field.key)"
              /><span v-if="priceChange(entry, field.key)" class="field__note tabular">{{
                priceChange(entry, field.key)
              }}</span></label
            >
          </div>
        </li>
      </ul>
      <p v-else class="form__hint">
        No Pricing Windows attached: the standard prices always apply.
      </p>
      <div class="field">
        <span class="field__label">Attach</span>
        <AppSelect
          model-value=""
          :options="attachOptions"
          label="Attach a Pricing Window"
          :placeholder="attachPlaceholder"
          searchable
          empty-text="No Pricing Windows yet"
          @update:model-value="handleAttach"
        />
      </div>
      <p class="form__hint">
        Manage the windows' schedules on the
        <NuxtLink to="/pricing-windows">Pricing Windows</NuxtLink> page.
      </p>
      <p v-if="saveError" class="form__error" role="alert">{{ saveError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="isOpen = false">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">Save</button>
      </div>
    </form>
  </AppDialog>
</template>
