<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue';
import { computed } from 'vue';
import {
  POLICY_PARAMETERS,
  type ParameterPolicy,
  type ParameterValues,
  RULE_KINDS,
} from '~/lib/parameterPolicy';
import type { ModelDetail, RouteSummary } from '~/lib/routing';
import { formatCount } from '~/lib/usage';

const props = defineProps<{
  model: ModelDetail | null;
  isLoading: boolean;
  hasError: boolean;
  providerLogos: Map<string, string | null>;
}>();

function blockerOf(route: RouteSummary): string | null {
  if (!route.isEnabled) return 'Route disabled';
  if (!route.provider.isEnabled) return 'Provider disabled';
  if (!route.upstreamModel.isEnabled) return 'Upstream Model disabled';
  if (route.enabledProviderAccountCount === 0) return 'No enabled Provider Account';
  return null;
}

const routes = computed(() =>
  (props.model?.routes ?? []).map((route) => ({ route, blocker: blockerOf(route) })),
);
const usableCount = computed(() => routes.value.filter(({ blocker }) => !blocker).length);
function formatValue(name: keyof ParameterValues, values: ParameterValues): string {
  const value = values[name];
  if (Array.isArray(value)) return value.map((stop) => JSON.stringify(stop)).join(', ');
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  const isTokenCount = name === 'maxOutputTokens' || name === 'reasoningBudgetTokens';
  if (isTokenCount && typeof value === 'number') return formatCount(value);
  return String(value);
}

function policyRules(policy: ParameterPolicy): { key: string; label: string; value: string }[] {
  const rules: { key: string; label: string; value: string }[] = [];
  for (const { kind, label: kindLabel } of RULE_KINDS) {
    const values = policy[kind];
    if (!values) continue;
    for (const { name, label } of POLICY_PARAMETERS) {
      if (Reflect.get(values, name) === undefined) continue;
      rules.push({
        key: `${kind}-${name}`,
        label: `${label} · ${kindLabel.toLowerCase()}`,
        value: formatValue(name, values),
      });
    }
  }
  return rules;
}

const rules = computed(() => (props.model ? policyRules(props.model.parameterPolicy) : []));
const hasPolicyPrompt = computed(() => Boolean(props.model?.parameterPolicy.systemPrompt?.trim()));
</script>

<template>
  <div class="route-preview">
    <div v-if="isLoading && !model" class="route-preview__loading"><AppSpinner /></div>
    <p v-else-if="hasError" class="route-preview__note">
      Couldn't load this Model's Routes. You can still send a message.
    </p>

    <template v-else-if="model">
      <section class="route-preview__section" aria-labelledby="route-preview-routes">
        <header class="route-preview__heading">
          <h2 id="route-preview-routes">Routes for {{ model.name }}</h2>
          <p v-if="routes.length === 0" class="route-preview__warn">
            <TriangleAlert :size="13" /> No Routes, so every request fails.
            <NuxtLink :to="`/models/${model.id}`">Add one</NuxtLink>
          </p>
          <p v-else-if="usableCount === 0" class="route-preview__warn">
            <TriangleAlert :size="13" /> None of the {{ routes.length }} Routes can serve requests.
          </p>
          <p v-else>
            Tried top to bottom; a failed Route falls back to the next.
            <span class="tabular">{{ usableCount }} of {{ routes.length }}</span> can serve.
          </p>
        </header>
        <ol v-if="routes.length > 0" class="route-list">
          <li
            v-for="({ route, blocker }, index) in routes"
            :key="route.id"
            class="route-list__item"
            :class="{ 'route-list__item--blocked': blocker }"
          >
            <span class="route-list__order tabular" aria-hidden="true">{{ index + 1 }}</span>
            <ProviderLogo
              class="provider-mark--sm"
              :logo="providerLogos.get(route.provider.slug) ?? null"
              :name="route.provider.name"
              base-url=""
            />
            <span class="route-list__body">
              <strong>{{ route.upstreamModel.upstreamModelId }}</strong>
              <span class="route-list__meta">
                {{ route.provider.name }}
                <template v-if="!blocker">
                  · {{ route.enabledProviderAccountCount }}
                  {{ route.enabledProviderAccountCount === 1 ? 'account' : 'accounts' }}
                </template>
                <template v-if="route.parameterPolicyOverride"> · own policy</template>
              </span>
            </span>
            <span class="route-list__tags">
              <span v-if="blocker" class="status-badge status-badge--warn">{{ blocker }}</span>
              <template v-else>
                <span
                  v-for="capability in route.upstreamModel.capabilities"
                  :key="capability"
                  class="chip"
                  >{{ capability }}</span
                >
              </template>
            </span>
          </li>
        </ol>
      </section>

      <section class="route-preview__section" aria-labelledby="route-preview-policy">
        <header class="route-preview__heading">
          <h2 id="route-preview-policy">Parameter Policy</h2>
          <p v-if="rules.length === 0 && !hasPolicyPrompt">
            None set. Parameters you leave empty are not sent.
          </p>
          <p v-else>Applied by the gateway on top of what you send.</p>
        </header>
        <dl v-if="rules.length > 0 || hasPolicyPrompt" class="policy-facts">
          <div v-for="rule in rules" :key="rule.key">
            <dt>{{ rule.label }}</dt>
            <dd class="tabular">{{ rule.value }}</dd>
          </div>
          <div v-if="hasPolicyPrompt">
            <dt>System prompt</dt>
            <dd>Placed before yours</dd>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>
