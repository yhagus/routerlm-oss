<script setup lang="ts">
import { computed } from "vue";
import { PROVIDER_LOGOS } from "~/lib/providerLogos";

const props = defineProps<{
  /** The Provider's chosen mark; null or an unknown key picks one by the base URL's host. */
  logo: string | null;
  name: string;
  baseUrl: string;
}>();

/** Logo keys by the host the base URL points at, so a Provider with no logo on a known host gets its mark. */
const LOGOS_BY_HOST: [RegExp, string][] = [
  [/(^|\.)openai\.com$/, "openai"],
  [/(^|\.)anthropic\.com$/, "anthropic"],
  [/(^|\.)deepseek\.com$/, "deepseek"],
  [/(^|\.)kimi\.(ai|com)$/, "kimi"],
  [/(^|\.)moonshot\.(ai|cn)$/, "moonshot"],
  [/(^|\.)minimaxi?\.(io|com|chat)$/, "minimax"],
  [/(^|\.)xiaomimimo\.com$/, "xiaomimimo"],
  [/(^|\.)(aliyuncs|alibabacloud)\.com$/, "alibabacloud"],
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const mark = computed(() => {
  const chosen = props.logo === null ? undefined : PROVIDER_LOGOS.get(props.logo);
  if (chosen) return chosen.svg;
  const host = hostOf(props.baseUrl);
  const hostLogo = LOGOS_BY_HOST.find(([pattern]) => pattern.test(host))?.[1];
  return hostLogo === undefined ? null : (PROVIDER_LOGOS.get(hostLogo)?.svg ?? null);
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
