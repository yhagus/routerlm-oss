<script setup lang="ts">
import { Check, Copy } from '@lucide/vue';
import { computed, useTemplateRef } from 'vue';
import { type CodeExample, labelOf } from '~/lib/docsCode';

const props = defineProps<{ examples: CodeExample[] }>();

const { t } = useDocsLocale();
const { preferredLanguage, choose } = useDocsCodeLanguage();
const { withGatewayUrl } = useGatewayUrl();
const { state: copyState, copy } = useCopyFeedback();
const codeElement = useTemplateRef<HTMLElement>('code');

const tabs = computed(() =>
  props.examples.map((example) => ({
    language: example.language,
    label: labelOf(example),
    code: withGatewayUrl(example.code),
  })),
);
const hasTabs = computed(() => tabs.value.length > 1);
const visibleTab = computed(
  () => tabs.value.find((tab) => tab.language === preferredLanguage.value) ?? tabs.value[0],
);

const copyLabel = computed(() => {
  if (copyState.value === 'copied') return t('copied');
  if (copyState.value === 'manual') return t('pressShortcut', { shortcut: copyShortcut() });
  return t('copy');
});
const copyAnnouncement = computed(() => {
  if (copyState.value === 'copied') return t('codeCopied');
  if (copyState.value === 'manual') return t('codeSelected', { shortcut: copyShortcut() });
  return '';
});

const captionLabel = computed(() =>
  copyState.value === 'copied' ? t('copied') : (visibleTab.value?.label ?? ''),
);

async function handleCopy(): Promise<void> {
  if (visibleTab.value) await copy(visibleTab.value.code, codeElement.value);
}
</script>

<template>
  <figure v-if="visibleTab" class="ds-figure">
    <div class="ds-figure__header">
      <div
        v-if="hasTabs"
        class="segmented ds-figure__tabs"
        role="group"
        :aria-label="t('exampleLanguage')"
      >
        <button
          v-for="tab in tabs"
          :key="tab.language"
          class="segmented__option ds-figure__tab"
          type="button"
          :aria-pressed="tab.language === visibleTab.language"
          @click="choose(tab.language)"
        >
          {{ tab.label }}
        </button>
      </div>
      <span v-else class="ds-figure__label">{{ visibleTab.label }}</span>
      <button class="ds-figure__copy" type="button" @click="handleCopy">
        <Check v-if="copyState === 'copied'" :size="14" :stroke-width="2" aria-hidden="true" />
        <Copy v-else :size="14" :stroke-width="1.75" aria-hidden="true" />
        <span>{{ copyLabel }}</span>
      </button>
      <span class="sr-only" role="status">{{ copyAnnouncement }}</span>
    </div>
    <pre tabindex="0"><code ref="code">{{ visibleTab.code }}</code></pre>
    <figcaption class="ds-figure__caption">
      <span class="ds-figure__number">{{ t('figure') }}</span> · {{ captionLabel }}
    </figcaption>
  </figure>
</template>
