<script setup lang="ts">
import { Copy, TriangleAlert } from '@lucide/vue';
import type { CreatedIntegration } from '~/lib/integrations';

const props = defineProps<{
  integration: CreatedIntegration;
  verb: 'created' | 'rotated';
}>();
const isOpen = defineModel<boolean>('open', { required: true });

const { showToast } = useToast();

const description = computed(() =>
  props.verb === 'rotated'
    ? 'Give this Integration Secret to the application. The old one no longer works.'
    : 'Give this Integration Secret to the application, so it can issue API Keys to its Customers.',
);

async function copySecret(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.integration.secret);
    showToast('Integration Secret copied');
  } catch {
    showToast("Couldn't copy. Select the Integration Secret and copy it yourself.");
  }
}

function selectAll(event: FocusEvent): void {
  if (event.target instanceof HTMLInputElement) event.target.select();
}
</script>

<template>
  <AppDialog
    v-model:open="isOpen"
    :title="`${integration.name} ${verb}`"
    :description="description"
  >
    <div class="key-reveal">
      <input
        class="text-input key-reveal__value tabular"
        type="text"
        :value="integration.secret"
        aria-label="Integration Secret"
        readonly
        @focus="selectAll"
      />
      <button class="button" type="button" @click="copySecret"><Copy :size="14" /> Copy</button>
    </div>
    <p class="secret-warning" role="note">
      <TriangleAlert :size="13" /> It can't be shown again. If it is lost, rotate it to get a new
      one.
    </p>
    <div class="dialog__actions">
      <button class="button button--primary" type="button" @click="isOpen = false">Done</button>
    </div>
  </AppDialog>
</template>
