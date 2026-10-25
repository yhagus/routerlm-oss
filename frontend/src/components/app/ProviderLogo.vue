<script setup lang="ts">
import { ref, watch } from "vue";
import { providerLogo } from "@/lib/providerAssets";

// `src` overrides the bundled asset, e.g. a custom provider's uploaded logo.
const props = withDefaults(
  defineProps<{ provider?: string; label?: string; size?: string; src?: string }>(),
  { size: "size-9" },
);
const failed = ref(false);
watch(
  () => [props.src, props.provider],
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <div
    :class="[
      'grid shrink-0 place-items-center overflow-hidden rounded-lg bg-accent text-xs font-bold text-accent-foreground',
      props.size,
    ]"
  >
    <img
      v-if="props.src && !failed"
      :src="props.src"
      :alt="`${label || provider || 'Provider'} logo`"
      class="size-full object-contain"
      @error="failed = true"
    />
    <template v-else-if="props.provider === 'zenmux'">
      <img
        src="/providers/zenmux-light.svg"
        :alt="`${label || 'ZenMux'} logo`"
        class="size-full object-contain dark:hidden"
      />
      <img
        src="/providers/zenmux-dark.svg"
        :alt="`${label || 'ZenMux'} logo`"
        class="hidden size-full object-contain dark:block"
      />
    </template>
    <template v-else>
      <img
        v-if="!props.src && !failed && providerLogo(provider)"
        :src="providerLogo(provider)"
        :alt="`${label || provider || 'Provider'} logo`"
        class="size-full object-contain"
        @error="failed = true"
      />
      <span v-else>{{
        (label || provider || "?").slice(0, 2).toUpperCase()
      }}</span>
    </template>
  </div>
</template>
