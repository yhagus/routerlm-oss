<script setup lang="ts">
import { computed } from "vue";
import alibabacloud from "~/assets/provider-logos/alibabacloud.svg?raw";
import anthropic from "~/assets/provider-logos/anthropic.svg?raw";
import deepseek from "~/assets/provider-logos/deepseek.svg?raw";
import kimi from "~/assets/provider-logos/kimi.svg?raw";
import minimax from "~/assets/provider-logos/minimax.svg?raw";
import moonshot from "~/assets/provider-logos/moonshot.svg?raw";
import openai from "~/assets/provider-logos/openai.svg?raw";
import xiaomimimo from "~/assets/provider-logos/xiaomimimo.svg?raw";

const props = defineProps<{ slug: string; name: string; baseUrl: string }>();

/**
 * Marks by the host the base URL points at, so a hand-added Provider on a known
 * host gets its mark too; Catalog slugs are the fallback for workspace hosts.
 * Vendored files, so `v-html` renders nothing untrusted.
 */
const MARKS_BY_HOST: [RegExp, string][] = [
  [/(^|\.)openai\.com$/, openai],
  [/(^|\.)anthropic\.com$/, anthropic],
  [/(^|\.)deepseek\.com$/, deepseek],
  [/(^|\.)kimi\.(ai|com)$/, kimi],
  [/(^|\.)moonshot\.(ai|cn)$/, moonshot],
  [/(^|\.)minimaxi?\.(io|com|chat)$/, minimax],
  [/(^|\.)xiaomimimo\.com$/, xiaomimimo],
  [/(^|\.)(aliyuncs|alibabacloud)\.com$/, alibabacloud],
];
const MARKS_BY_SLUG: Record<string, string> = {
  openai,
  anthropic,
  deepseek,
  "kimi-code": kimi,
  moonshot,
  minimax,
  "xiaomi-mimo": xiaomimimo,
  "alibaba-model-studio-intl": alibabacloud,
};

const mark = computed(() => {
  let host = "";
  try {
    host = new URL(props.baseUrl).hostname;
  } catch {
    // An unparsable base URL falls through to the slug.
  }
  return (
    MARKS_BY_HOST.find(([pattern]) => pattern.test(host))?.[1] ?? MARKS_BY_SLUG[props.slug] ?? null
  );
});

const monogram = computed(() =>
  props.name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join(""),
);
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <span v-if="mark" class="provider-mark" aria-hidden="true" v-html="mark" />
  <span v-else class="provider-mark provider-mark--monogram" aria-hidden="true">{{
    monogram
  }}</span>
</template>
