<script setup lang="ts">
import { Check, Copy } from '@lucide/vue';
import { computed } from 'vue';
import { readableMarkdownOf } from '~/lib/docsCode';

const props = defineProps<{
  title: string;
  description?: string;
  endpoint?: string;
  pageCounter: string | null;
  markdown: string;
}>();

const { t } = useDocsLocale();
const appVersion = useRuntimeConfig().public.appVersion;
const { withGatewayUrl } = useGatewayUrl();
const { state: copyState, copy } = useCopyFeedback();

const copyLabel = computed(() => {
  if (copyState.value === 'copied') return t('copied');
  if (copyState.value === 'failed') return t('copyFailed');
  return t('copyPage');
});

async function handleCopyPage(): Promise<void> {
  await copy(withGatewayUrl(readableMarkdownOf(props.markdown)));
}
</script>

<template>
  <header class="ds-title">
    <div class="ds-title__main">
      <h1>{{ title }}</h1>
      <p v-if="description" class="ds-title__description">{{ description }}</p>
    </div>
    <div class="ds-title__cells">
      <dl v-if="endpoint" class="ds-title__cell ds-title__cell--endpoint">
        <dt>{{ t('endpoint') }}</dt>
        <dd class="ds-title__value">{{ endpoint }}</dd>
      </dl>
      <dl v-if="pageCounter" class="ds-title__cell">
        <dt>{{ t('page') }}</dt>
        <dd class="ds-title__value">{{ pageCounter }}</dd>
      </dl>
      <dl class="ds-title__cell">
        <dt>{{ t('revision') }}</dt>
        <dd class="ds-title__value">{{ appVersion }}</dd>
      </dl>
      <div class="ds-title__cell ds-title__cell--action">
        <button class="ds-title__copy" type="button" @click="handleCopyPage">
          <Check v-if="copyState === 'copied'" :size="15" :stroke-width="2" aria-hidden="true" />
          <Copy v-else :size="15" :stroke-width="1.75" aria-hidden="true" />
          <span>{{ copyLabel }}</span>
        </button>
        <span class="sr-only" role="status">{{
          copyState === 'copied' ? t('pageCopied') : ''
        }}</span>
      </div>
    </div>
  </header>
</template>
