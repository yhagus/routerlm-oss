<script setup lang="ts">
import type { NuxtError } from '#app';
import {
  Check,
  ChevronRight,
  Copy,
  FileQuestionMark,
  RotateCw,
  SearchX,
  TriangleAlert,
} from '@lucide/vue';
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { isNotFound, missingResourceHint, missingResourceOf } from '~/lib/errors';
import { findNavigationItem } from '~/lib/navigation';

const COPY_FEEDBACK_MS = 2000;

const props = defineProps<{ error: NuxtError }>();

const route = useRoute();
const currentUser = useCurrentUser();

const occurredAt = new Date().toISOString();
const notFound = computed(() => isNotFound(props.error));
const resource = computed(() => missingResourceOf(props.error));
const section = computed(() => findNavigationItem(route.path));
const backLabel = computed(() =>
  section.value && section.value.path !== '/' ? `Back to ${section.value.label}` : 'Go to Overview',
);

const statusLabel = computed(() => (notFound.value ? 'Not found' : 'Error'));
const headline = computed(() => {
  if (resource.value) return `This ${resource.value} doesn't exist.`;
  if (notFound.value) return "This page doesn't exist.";
  return 'Something went wrong on this page.';
});
const hint = computed(() => {
  if (resource.value) return missingResourceHint(resource.value);
  if (notFound.value) return 'The link may be out of date, or the address was mistyped.';
  return "The dashboard hit an error it couldn't recover from. Try again; if it keeps happening, copy the details into a bug report.";
});
const icon = computed(() => {
  if (resource.value) return FileQuestionMark;
  return notFound.value ? SearchX : TriangleAlert;
});
const detailMessage = computed(() => {
  if (resource.value) return props.error.message;
  if (notFound.value) return 'No dashboard page matches this address.';
  return props.error.message || 'No message was given.';
});
const statusText = computed(() =>
  notFound.value
    ? `${props.error.statusCode} Not Found`
    : `${props.error.statusCode} ${props.error.statusMessage || 'Error'}`,
);

useHead({ title: `${statusLabel.value} · RouterLM` });

const copyState = ref<'idle' | 'copied' | 'failed'>('idle');
let copyTimer: ReturnType<typeof setTimeout> | undefined;

async function copyDetails(): Promise<void> {
  const report = [
    `Status: ${statusText.value}`,
    `Message: ${detailMessage.value}`,
    `Time: ${occurredAt}`,
  ].join('\n');
  try {
    await navigator.clipboard.writeText(report);
    copyState.value = 'copied';
  } catch {
    copyState.value = 'failed';
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => (copyState.value = 'idle'), COPY_FEEDBACK_MS);
}

function goBack(): void {
  void clearError({ redirect: section.value?.path ?? '/' });
}

function tryAgain(): void {
  reloadNuxtApp({ path: route.fullPath, force: true });
}

const headlineRef = useTemplateRef<HTMLHeadingElement>('headline');
onMounted(() => headlineRef.value?.focus());
</script>

<template>
  <NuxtLayout :name="currentUser ? 'default' : 'auth'">
    <section class="error-view" :class="{ 'panel error-view--panel': currentUser }">
      <div class="error-view__status">
        <span
          class="error-view__icon"
          :class="{ 'error-view__icon--error': !notFound }"
          aria-hidden="true"
        >
          <component :is="icon" :size="18" :stroke-width="1.75" />
        </span>
        <span class="error-view__code">{{ error.statusCode }} · {{ statusLabel }}</span>
      </div>

      <div class="error-view__copy">
        <h1 ref="headline" tabindex="-1">{{ headline }}</h1>
        <p>{{ hint }}</p>
      </div>

      <div class="error-view__actions">
        <button type="button" class="button button--primary" @click="goBack">
          {{ backLabel }}
        </button>
        <button v-if="!notFound" type="button" class="button button--quiet" @click="tryAgain">
          <RotateCw :size="14" /> Try again
        </button>
      </div>

      <details class="error-details">
        <summary><ChevronRight :size="14" aria-hidden="true" />Technical details</summary>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{{ statusText }}</dd>
          </div>
          <div>
            <dt>Message</dt>
            <dd>{{ detailMessage }}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd><time :datetime="occurredAt">{{ occurredAt }}</time></dd>
          </div>
        </dl>
        <button type="button" class="button error-details__copy" @click="copyDetails">
          <Check v-if="copyState === 'copied'" :size="14" /><Copy v-else :size="14" />
          <span aria-live="polite">{{
            copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? "Couldn't copy"
                : 'Copy details'
          }}</span>
        </button>
      </details>
    </section>
  </NuxtLayout>
</template>
