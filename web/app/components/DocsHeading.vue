<script setup lang="ts">
import { Check, Link } from "@lucide/vue";
import { pickHeading } from "~/composables/useActiveHeading";

const props = defineProps<{ level: 2 | 3; id?: string }>();

const { t } = useDocsLocale();
const { state: copyState, copy } = useCopyFeedback();

async function handleAnchorClick(id: string): Promise<void> {
  const sectionUrl = new URL(location.href);
  sectionUrl.hash = id;
  pickHeading(id);
  await copy(sectionUrl.toString());
}
</script>

<template>
  <component :is="`h${props.level}`" :id="id" class="ds-heading">
    <slot />
    <a
      v-if="id"
      :href="`#${id}`"
      class="ds-heading__anchor"
      :aria-label="t('copySectionLink')"
      @click.prevent="handleAnchorClick(id)"
    >
      <Check v-if="copyState === 'copied'" :size="14" :stroke-width="2" aria-hidden="true" />
      <Link v-else :size="14" :stroke-width="1.75" aria-hidden="true" />
    </a>
  </component>
  <span class="sr-only" role="status">{{
    copyState === "copied" ? t("sectionLinkCopied") : ""
  }}</span>
</template>
