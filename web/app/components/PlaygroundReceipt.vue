<script setup lang="ts">
import { computed } from "vue";
import type { PlaygroundSummary } from "~/lib/playground";
import type { RouteSummary } from "~/lib/routing";
import { formatCost, formatCount } from "~/lib/usage";

/**
 * What the gateway reported after an answer: which Route served it, in the
 * order the Model tried them, then tokens and Cost.
 */
const props = defineProps<{
  summary: PlaygroundSummary;
  /** The Model's Routes when the request was sent, or null if they weren't loaded. */
  routes: RouteSummary[] | null;
  /** Sent straight to an Upstream Model, with no Model or Route. */
  direct: boolean;
  /** Provider names by slug, for answers no Route snapshot names. */
  providerNames: Map<string, string>;
  /** Provider logos by slug: the summary names its Provider without one. */
  providerLogos: Map<string, string | null>;
}>();

/** Who answered: the served Route's Upstream Model, or the direct target. */
const answered = computed(() => props.summary.route ?? props.summary.upstreamModel);
const providerName = computed(() => {
  if (!answered.value) return "";
  const slug = answered.value.providerSlug;
  return served.value?.providerName ?? props.providerNames.get(slug) ?? slug;
});

/** The served Route's place in the fallback order: 1 means no fallback happened. */
const served = computed(() => {
  const route = props.summary.route;
  if (!route || !props.routes) return null;
  const index = props.routes.findIndex((candidate) => candidate.id === route.id);
  if (index === -1) return null;
  return {
    order: index + 1,
    total: props.routes.length,
    providerName: props.routes[index]?.provider.name ?? route.providerSlug,
  };
});

/** A media Kind's units, or a chat answer's tokens; then Cost. */
const facts = computed(() => {
  const { usage, units } = props.summary;
  if (units) {
    const list: { label: string; value: string }[] = [];
    if (units.imagesIn !== undefined) {
      list.push({ label: "Images in", value: formatCount(units.imagesIn) });
    }
    if (units.imagesOut !== undefined) {
      list.push({ label: "Images out", value: formatCount(units.imagesOut) });
    }
    if (units.characters !== undefined) {
      list.push({ label: "Characters", value: formatCount(units.characters) });
    }
    if (units.outputSeconds !== undefined) {
      list.push({ label: "Video seconds", value: formatCount(units.outputSeconds) });
    }
    if (units.tier !== undefined) list.push({ label: "Tier", value: units.tier });
    list.push({ label: "Cost", value: formatCost(props.summary.cost) });
    return list;
  }
  const list = [
    { label: "Input", value: formatCount(usage.inputTokens) },
    { label: "Output", value: formatCount(usage.outputTokens) },
    { label: "Cache read", value: formatCount(usage.cacheReadTokens) },
    { label: "Cache write", value: formatCount(usage.cacheWriteTokens) },
  ];
  if (usage.reasoningTokens !== null) {
    list.push({ label: "Reasoning", value: formatCount(usage.reasoningTokens) });
  }
  list.push({ label: "Cost", value: formatCost(props.summary.cost) });
  return list;
});
</script>

<template>
  <footer class="receipt">
    <p class="receipt__route">
      <template v-if="answered">
        <ProviderLogo
          class="provider-mark--xs"
          :logo="providerLogos.get(answered.providerSlug) ?? null"
          :name="providerName"
          base-url=""
        />
        <span class="receipt__served">
          <strong>{{ answered.upstreamModelId }}</strong>
          <span>via {{ providerName }}</span>
        </span>
        <span v-if="direct" class="chip">Direct, no Route</span>
        <span v-else-if="served" class="chip tabular"
          >Route {{ served.order }} of {{ served.total }}</span
        >
        <span v-if="served && served.order > 1" class="status-badge status-badge--warn"
          >Fell back past {{ served.order - 1 }} {{ served.order === 2 ? "Route" : "Routes" }}</span
        >
      </template>
      <span v-else class="receipt__served">{{
        direct ? "The Upstream Model didn't answer" : "No Route served this request"
      }}</span>
      <span v-if="summary.providerAccount" class="chip receipt__account">{{
        summary.providerAccount.name
      }}</span>
    </p>
    <dl class="receipt__facts">
      <div v-for="fact in facts" :key="fact.label">
        <dt>{{ fact.label }}</dt>
        <dd class="tabular">{{ fact.value }}</dd>
      </div>
    </dl>
  </footer>
</template>
