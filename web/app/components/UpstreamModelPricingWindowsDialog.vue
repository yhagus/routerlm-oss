<script setup lang="ts">
import { ArrowDown, ArrowUp, CalendarClock, Unlink } from "@lucide/vue";
import { apiErrorMessage } from "~/lib/api";
import {
  activePricingWindowOf,
  type PricingWindow,
  WINDOW_PRICE_FIELDS,
  type WindowPrices,
} from "~/lib/pricingWindows";
import {
  numberField,
  optionalNumber,
  type UpstreamModel,
  upstreamModelLabel,
} from "~/lib/upstream";

/**
 * A chat Upstream Model's Pricing Windows: attach, set Window Prices, reorder
 * and detach, then save the whole ordered list with one PUT. The first
 * enabled window active at a request's time sets its prices.
 */
const props = defineProps<{
  upstreamModel: UpstreamModel;
  /** Reloads the Upstream Models after a save. */
  refresh: () => Promise<unknown>;
}>();
const isOpen = defineModel<boolean>("open", { required: true });

/** One attached window as the inputs hold it: each price a typed string, "" for standard. */
interface AttachedWindowForm {
  pricingWindowId: string;
  name: string;
  isEnabled: boolean;
  prices: Record<keyof WindowPrices, string | number>;
}

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const { data: pricingWindows, status } = useDashboardApi<PricingWindow[]>("/pricing-windows");

const attached = ref<AttachedWindowForm[]>(
  props.upstreamModel.pricingWindows.map((entry) => ({
    pricingWindowId: entry.pricingWindowId,
    name: entry.name,
    isEnabled: entry.isEnabled,
    prices: {
      inputPrice: numberField(entry.inputPrice),
      outputPrice: numberField(entry.outputPrice),
      cacheReadPrice: numberField(entry.cacheReadPrice),
      cacheWritePrice: numberField(entry.cacheWritePrice),
    },
  })),
);
const isSaving = ref(false);
const saveError = ref("");

const title = computed(() => `Pricing Windows of ${upstreamModelLabel(props.upstreamModel)}`);

/** The saved window whose prices apply now; unsaved edits don't reach the gateway yet. */
const inEffectWindowId = computed(
  () => activePricingWindowOf(props.upstreamModel.pricingWindows)?.pricingWindowId,
);

/** The picker offers only the windows not attached yet. */
const attachOptions = computed(() =>
  (pricingWindows.value ?? [])
    .filter((entry) => !attached.value.some((each) => each.pricingWindowId === entry.id))
    .map((entry) => ({
      label: entry.isEnabled ? entry.name : `${entry.name} (disabled)`,
      value: entry.id,
    })),
);
const attachPlaceholder = computed(() => {
  if (status.value === "pending") return "Loading Pricing Windows…";
  return attachOptions.value.length > 0 ? "Attach a Pricing Window" : "Every window is attached";
});

/** The standard price as an empty Window Price's placeholder: what applies when it's left out. */
function standardPlaceholder(key: keyof WindowPrices): string {
  const standard = props.upstreamModel[key];
  return standard === null ? "Standard (none)" : `${standard} (standard)`;
}

function handleAttach(pricingWindowId: string): void {
  const entry = pricingWindows.value?.find((each) => each.id === pricingWindowId);
  if (!entry) return;
  attached.value.push({
    pricingWindowId: entry.id,
    name: entry.name,
    isEnabled: entry.isEnabled,
    prices: { inputPrice: "", outputPrice: "", cacheReadPrice: "", cacheWritePrice: "" },
  });
}

/** Swaps the window at `index` with its neighbour `offset` places away. */
function handleMove(index: number, offset: -1 | 1): void {
  const moved = attached.value[index];
  const neighbour = attached.value[index + offset];
  if (!moved || !neighbour) return;
  attached.value.splice(index, 1, neighbour);
  attached.value.splice(index + offset, 1, moved);
}

function handleDetach(pricingWindowId: string): void {
  attached.value = attached.value.filter((each) => each.pricingWindowId !== pricingWindowId);
}

function windowPricesBody(entry: AttachedWindowForm) {
  const prices = Object.fromEntries(
    WINDOW_PRICE_FIELDS.map(({ key }) => [key, optionalNumber(entry.prices[key])]),
  );
  return { pricingWindowId: entry.pricingWindowId, ...prices };
}

async function handleSave(): Promise<void> {
  isSaving.value = true;
  saveError.value = "";
  try {
    await $dashboardApi(`/upstream-models/${props.upstreamModel.id}/pricing-windows`, {
      method: "PUT",
      body: attached.value.map(windowPricesBody),
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
    description="The first enabled window active at a request's time sets its prices. Leave a price empty to keep the standard one."
  >
    <form class="form" @submit.prevent="handleSave">
      <ol v-if="attached.length > 0" class="window-prices">
        <li
          v-for="(entry, index) in attached"
          :key="entry.pricingWindowId"
          class="window-prices__item"
        >
          <div class="window-prices__head">
            <span class="window-prices__order tabular" aria-hidden="true">{{ index + 1 }}</span>
            <strong>{{ entry.name }}</strong>
            <span v-if="!entry.isEnabled" class="status-badge status-badge--warn">Disabled</span>
            <span
              v-if="entry.pricingWindowId === inEffectWindowId"
              class="status-badge status-badge--good"
              title="Its Window Prices apply now"
              ><CalendarClock :size="12" aria-hidden="true" />Active now</span
            >
            <span class="window-prices__actions">
              <button
                class="icon-button"
                type="button"
                :aria-label="`Move ${entry.name} up`"
                title="Move up"
                :disabled="index === 0"
                @click="handleMove(index, -1)"
              >
                <ArrowUp :size="14" />
              </button>
              <button
                class="icon-button"
                type="button"
                :aria-label="`Move ${entry.name} down`"
                title="Move down"
                :disabled="index === attached.length - 1"
                @click="handleMove(index, 1)"
              >
                <ArrowDown :size="14" />
              </button>
              <button
                class="icon-button"
                type="button"
                :aria-label="`Detach ${entry.name}`"
                title="Detach"
                @click="handleDetach(entry.pricingWindowId)"
              >
                <Unlink :size="14" />
              </button>
            </span>
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
            /></label>
          </div>
        </li>
      </ol>
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
