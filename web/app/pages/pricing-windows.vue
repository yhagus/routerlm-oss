<script setup lang="ts">
import { CalendarClock, Pencil, Plus, Power, Trash2 } from '@lucide/vue';
import type { RowAction } from '~/components/RowActionsMenu.vue';
import { actionsColumn, type DataTableColumn } from '~/lib/dataTable';
import {
  formatRange,
  ianaTimeZones,
  type PricingWindow,
  type RangeForm,
  rangeFormFor,
  rangesFromForm,
} from '~/lib/pricingWindows';
import { browserTimeZone, utcOffsetLabel } from '~/lib/timeZones';

useHead({ title: 'Pricing Windows' });

type PricingWindowDialog =
  | { kind: 'create' }
  | { kind: 'edit'; pricingWindow: PricingWindow }
  | { kind: 'delete'; pricingWindow: PricingWindow };

type RowActionId = 'edit' | 'toggle' | 'delete';

const { $dashboardApi } = useNuxtApp();
const {
  data: pricingWindows,
  status,
  error: loadError,
  refresh,
} = useDashboardApi<PricingWindow[]>('/pricing-windows');

const isLoading = computed(() => status.value === 'pending' && !pricingWindows.value);

const columns: DataTableColumn<PricingWindow>[] = [
  { id: 'name', header: 'Pricing Window', enableHiding: false, accessorFn: (row) => row.name },
  { id: 'schedule', header: 'Schedule' },
  { id: 'timeZone', header: 'Time zone', accessorFn: (row) => row.timeZone },
  { id: 'status', header: 'Status' },
  { id: 'upstreamModels', header: 'Upstream Models' },
  actionsColumn(),
];

function rowActionsFor(pricingWindow: PricingWindow): RowAction<RowActionId>[] {
  return [
    { id: 'edit', label: 'Edit', icon: Pencil },
    { id: 'toggle', label: pricingWindow.isEnabled ? 'Disable' : 'Enable', icon: Power },
    { id: 'delete', label: 'Delete', icon: Trash2, isDestructive: true },
  ];
}

const {
  dialog,
  isDialogOpen,
  isSaving,
  dialogError,
  showDialog,
  closeDialog,
  submitDialog,
  deleteRow,
  toggleRow,
} = useEditableList<PricingWindowDialog>('/pricing-windows', refresh);

interface PricingWindowForm {
  name: string;
  timeZone: string;
  ranges: RangeForm[];
}

const form = ref<PricingWindowForm>(emptyForm());

function emptyForm(): PricingWindowForm {
  return { name: '', timeZone: browserTimeZone(), ranges: [rangeFormFor()] };
}

function formFor(pricingWindow: PricingWindow): PricingWindowForm {
  return {
    name: pricingWindow.name,
    timeZone: pricingWindow.timeZone,
    ranges: pricingWindow.ranges.map((range) => rangeFormFor(range)),
  };
}

function openDialog(next: PricingWindowDialog): void {
  if (next.kind === 'create') form.value = emptyForm();
  if (next.kind === 'edit') form.value = formFor(next.pricingWindow);
  showDialog(next);
}

function handleRowAction(id: RowActionId, pricingWindow: PricingWindow): void {
  if (id === 'toggle') {
    void toggleRow(pricingWindow, pricingWindow.name);
    return;
  }
  openDialog({ kind: id, pricingWindow });
}

const allTimeZoneOptions = ianaTimeZones().map((zone) => ({
  label: `${zone} (${utcOffsetLabel(zone, new Date())})`,
  value: zone,
}));
const timeZoneOptions = computed(() =>
  allTimeZoneOptions.some((option) => option.value === form.value.timeZone)
    ? allTimeZoneOptions
    : [{ label: form.value.timeZone, value: form.value.timeZone }, ...allTimeZoneOptions],
);

async function savePricingWindow(): Promise<void> {
  const current = dialog.value;
  const body = {
    name: form.value.name,
    timeZone: form.value.timeZone,
    ranges: rangesFromForm(form.value.ranges),
  };
  if (current?.kind === 'edit') {
    await submitDialog(
      () =>
        $dashboardApi(`/pricing-windows/${current.pricingWindow.id}`, { method: 'PATCH', body }),
      `Saved ${body.name}`,
      "Couldn't save the Pricing Window.",
    );
    return;
  }
  await submitDialog(
    () => $dashboardApi('/pricing-windows', { method: 'POST', body }),
    `Added ${body.name}`,
    "Couldn't add the Pricing Window.",
  );
}

function deletePricingWindow(pricingWindow: PricingWindow): Promise<void> {
  return deleteRow(pricingWindow, pricingWindow.name, "Couldn't delete the Pricing Window.");
}

function deleteDescription(pricingWindow: PricingWindow): string {
  const count = pricingWindow.attachedUpstreamModelCount;
  const reach =
    count === 0
      ? 'No Upstream Model uses it.'
      : `${count} Upstream ${count === 1 ? 'Model loses its' : 'Models lose their'} Window Prices for it.`;
  return `${pricingWindow.name} is deleted. ${reach} This can't be undone.`;
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Pricing Windows"
      description="Weekly hours, in a time zone, when an Upstream Model charges other prices: an off-peak discount or a promotion."
    >
      <button class="button button--primary" type="button" @click="openDialog({ kind: 'create' })">
        <Plus :size="14" /> Add Pricing Window
      </button>
    </PageHeading>

    <DataTable
      table-id="pricing-windows"
      label="Pricing Windows"
      search-placeholder="Search Pricing Windows"
      :columns="columns"
      :rows="pricingWindows ?? []"
      :get-row-id="(row) => row.id"
      :is-loading="isLoading"
      :error="loadError"
      :refresh="refresh"
    >
      <template #cell-name="{ row }">
        <div class="table-entity">
          <span class="key-icon"><CalendarClock :size="15" /></span><strong>{{ row.name }}</strong>
        </div>
      </template>
      <template #cell-schedule="{ row }">
        <ul class="pricing-window-ranges">
          <li v-for="(range, index) in row.ranges" :key="index" class="tabular">
            {{ formatRange(range) }}
          </li>
        </ul>
      </template>
      <template #cell-status="{ row }">
        <span v-if="!row.isEnabled" class="status-badge status-badge--warn">Disabled</span>
        <span v-else-if="row.isActiveNow" class="status-badge status-badge--good">Active now</span>
        <span v-else class="status-badge">Not active now</span>
      </template>
      <template #cell-upstreamModels="{ row }">
        <span class="tabular">{{ row.attachedUpstreamModelCount }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div class="row-actions">
          <RowActionsMenu
            :label="`Actions for ${row.name}`"
            :actions="rowActionsFor(row)"
            @select="(id) => handleRowAction(id, row)"
          />
        </div>
      </template>
      <template #empty>
        <EmptyState :icon="CalendarClock">
          <strong>No Pricing Windows yet.</strong>
          <span>Add one, then attach it to chat Upstream Models with their Window Prices.</span>
          <button class="text-button" type="button" @click="openDialog({ kind: 'create' })">
            <Plus :size="13" /> Add Pricing Window
          </button>
        </EmptyState>
      </template>
    </DataTable>

    <AppDialog
      v-if="dialog?.kind === 'create' || dialog?.kind === 'edit'"
      hide-description
      v-model:open="isDialogOpen"
      wide
      :title="dialog.kind === 'create' ? 'Add Pricing Window' : `Edit ${dialog.pricingWindow.name}`"
      description="Write the hours in the Provider's own time zone, as it publishes them."
    >
      <form class="form" @submit.prevent="savePricingWindow">
        <div class="form__grid">
          <label class="field"
            ><span class="field__label">Name</span
            ><input
              v-model="form.name"
              class="text-input"
              required
              placeholder="e.g. DeepSeek Off-Peak"
          /></label>
          <div class="field">
            <span class="field__label">Time zone</span>
            <AppSelect
              v-model="form.timeZone"
              :options="timeZoneOptions"
              label="Time zone"
              searchable
            />
          </div>
        </div>
        <PricingWindowRangesField v-model="form.ranges" />
        <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
        <div class="dialog__actions">
          <button class="button" type="button" @click="closeDialog">Cancel</button>
          <button class="button button--primary" type="submit" :disabled="isSaving">
            {{ dialog.kind === 'create' ? 'Add Pricing Window' : 'Save' }}
          </button>
        </div>
      </form>
    </AppDialog>

    <AppDialog
      v-if="dialog?.kind === 'delete'"
      v-model:open="isDialogOpen"
      title="Delete Pricing Window"
      :description="deleteDescription(dialog.pricingWindow)"
    >
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="closeDialog">Cancel</button>
        <button
          class="button button--danger"
          type="button"
          :disabled="isSaving"
          @click="deletePricingWindow(dialog.pricingWindow)"
        >
          Delete Pricing Window
        </button>
      </div>
    </AppDialog>
  </div>
</template>
