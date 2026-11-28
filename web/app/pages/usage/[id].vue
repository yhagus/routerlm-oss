<script setup lang="ts">
import { ArrowLeft, CloudOff, Unplug } from '@lucide/vue';
import type { ModelChoice } from '~/lib/api-keys';
import { ERROR_ORIGIN_LABELS } from '~/lib/errorOrigins';
import { isNotFound } from '~/lib/errors';
import { SERVICE_TIER_LABELS } from '~/lib/parameterPolicy';
import { recordedModelLabelOf } from '~/lib/routing';
import {
  FINISH_REASON_LABELS,
  formatCost,
  formatCount,
  formatDuration,
  playgroundUserLabel,
  USAGE_STATUS_BADGES,
  USAGE_STATUS_LABELS,
  type UsageLogDetail,
  usageStatusOf,
} from '~/lib/usage';

const { data: usageLog, error: loadError } = useDashboardApi<UsageLogDetail>(
  `/usage/${String(useRoute().params.id)}`,
);
useMissingResource(() => isNotFound(loadError.value), 'Usage Log');
const { data: modelChoices } = useDashboardApi<ModelChoice[]>('/api-keys/model-choices');
const modelHeading = computed(() => {
  if (!usageLog.value) return null;
  const modelChoiceById = new Map((modelChoices.value ?? []).map((model) => [model.id, model]));
  return recordedModelLabelOf(usageLog.value, modelChoiceById, 'No Model');
});

useHead({ title: 'Usage Log' });

const backTo = computed(() => {
  const previous: unknown = window.history.state?.back;
  return typeof previous === 'string' && /^\/usage(\?|$)/.test(previous) ? previous : '/usage';
});

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

const description = computed(() =>
  usageLog.value
    ? `Requested ${timeFormat.format(new Date(usageLog.value.createdAt))}.`
    : 'One client request and the Attempts the gateway made for it.',
);

const status = computed(() => (usageLog.value ? usageStatusOf(usageLog.value) : null));

const apiKeyLabel = computed(() => {
  const log = usageLog.value;
  if (!log) return '—';
  if (log.isPlayground) return 'Playground';
  return log.apiKeyName ?? (log.apiKeyId ? 'Deleted API Key' : '—');
});

interface Fact {
  label: string;
  value: string;
}

const responseFacts = computed<Fact[]>(() => {
  const log = usageLog.value;
  if (!log) return [];
  const facts: Fact[] = [];
  if (log.finishReason) {
    facts.push({ label: 'Finish Reason', value: FINISH_REASON_LABELS[log.finishReason] });
  }
  if (log.maxOutputTokens !== null) {
    facts.push({ label: 'Max output tokens', value: formatCount(log.maxOutputTokens) });
  }
  if (log.reasoningEffort) {
    facts.push({ label: 'Reasoning effort', value: log.reasoningEffort });
  }
  if (log.thinkingBudgetTokens !== null) {
    facts.push({
      label: 'Thinking budget',
      value: `${formatCount(log.thinkingBudgetTokens)} tokens`,
    });
  }
  if (log.isStreamed && log.reasoningTokens) {
    facts.push({ label: 'Reasoning streamed', value: log.isReasoningStreamed ? 'Yes' : 'No' });
  }
  if (log.toolCount > 0) {
    facts.push({ label: 'Tools', value: formatCount(log.toolCount) });
    facts.push({ label: 'Tool calls', value: formatCount(log.toolCallCount) });
  }
  if (log.imageCount !== null) {
    facts.push({ label: 'Images', value: formatCount(log.imageCount) });
  }
  return facts;
});
</script>

<template>
  <div class="page-view">
    <NuxtLink class="back-link" :to="backTo"><ArrowLeft :size="13" /> Usage</NuxtLink>

    <EmptyState v-if="loadError" class="panel" :icon="CloudOff" tone="error">
      <strong>Couldn't load this Usage Log.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>

    <template v-else>
      <PageHeading title="Usage Log" :description="description" />

      <section v-if="!usageLog || !status" class="panel loading-panel" aria-busy="true">
        <AppSpinner />
      </section>

      <template v-else>
        <section class="panel capture-summary">
          <header class="capture-summary__head">
            <div>
              <h2>{{ modelHeading?.label }}</h2>
              <code v-if="modelHeading?.note" class="cell-note">{{ modelHeading.note }}</code>
              <p>{{ apiKeyLabel }} · {{ usageLog.clientProtocol }}</p>
            </div>
            <p class="capture-outcome">
              <span class="capture-outcome__label">Client got</span>
              <span :class="['status-badge', USAGE_STATUS_BADGES[status]]"
                >{{ USAGE_STATUS_LABELS[status] }} ·
                {{ usageLog.errorCode ?? usageLog.httpStatus }}</span
              >
            </p>
          </header>
          <dl class="capture-facts">
            <div v-if="usageLog.isPlayground">
              <dt>User</dt>
              <dd>{{ playgroundUserLabel(usageLog) }}</dd>
            </div>
            <div>
              <dt>Upstream Model</dt>
              <dd>{{ usageLog.upstreamModelName ?? '—' }}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{{ usageLog.providerName ?? usageLog.providerSlug ?? '—' }}</dd>
            </div>
            <div>
              <dt>Provider Account</dt>
              <dd>{{ usageLog.providerAccountName ?? '—' }}</dd>
            </div>
            <template v-if="usageLog.integrationId">
              <div>
                <dt>Integration</dt>
                <dd>{{ usageLog.integrationName ?? '—' }}</dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd>{{ usageLog.customerId ?? '—' }}</dd>
              </div>
            </template>
            <div>
              <dt>Upstream Protocol</dt>
              <dd>{{ usageLog.upstreamProtocol ?? '—' }}</dd>
            </div>
            <div>
              <dt>Error Origin</dt>
              <dd>{{ usageLog.errorOrigin ? ERROR_ORIGIN_LABELS[usageLog.errorOrigin] : '—' }}</dd>
            </div>
            <div>
              <dt>User-Agent</dt>
              <dd>{{ usageLog.userAgent ?? '—' }}</dd>
            </div>
            <div>
              <dt>IP</dt>
              <dd class="tabular">{{ usageLog.clientIp ?? '—' }}</dd>
            </div>
            <div>
              <dt>Tier</dt>
              <dd>
                {{ usageLog.serviceTier ? SERVICE_TIER_LABELS[usageLog.serviceTier] : 'Default' }}
              </dd>
            </div>
            <div>
              <dt>Streamed</dt>
              <dd>{{ usageLog.isStreamed ? 'Yes' : 'No' }}</dd>
            </div>
            <div>
              <dt>Usage Log id</dt>
              <dd class="tabular">{{ usageLog.id }}</dd>
            </div>
            <div v-if="status === 'failed'">
              <dt>Error Captures</dt>
              <dd>
                <NuxtLink class="capture-link" :to="`/error-captures?usageLogId=${usageLog.id}`"
                  >Captures of this request</NuxtLink
                >
              </dd>
            </div>
          </dl>
          <dl class="capture-facts">
            <div>
              <dt>Input</dt>
              <dd class="tabular">{{ formatCount(usageLog.inputTokens) }}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd class="tabular">{{ formatCount(usageLog.outputTokens) }}</dd>
            </div>
            <div>
              <dt>Reasoning</dt>
              <dd class="tabular">{{ formatCount(usageLog.reasoningTokens) }}</dd>
            </div>
            <div>
              <dt>Cache read</dt>
              <dd class="tabular">{{ formatCount(usageLog.cacheReadTokens) }}</dd>
            </div>
            <div>
              <dt>Cache write</dt>
              <dd class="tabular">{{ formatCount(usageLog.cacheWriteTokens) }}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd class="tabular">
                {{ formatCost(usageLog.cost) }}
                <span v-if="usageLog.pricingWindowName" class="text-muted-foreground">
                  · {{ usageLog.pricingWindowName }}
                </span>
              </dd>
            </div>
            <div>
              <dt>Time to First Token</dt>
              <dd class="tabular">{{ formatDuration(usageLog.timeToFirstTokenMs) }}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd class="tabular">{{ formatDuration(usageLog.durationMs) }}</dd>
            </div>
          </dl>
          <dl v-if="responseFacts.length > 0" class="capture-facts">
            <div v-for="fact in responseFacts" :key="fact.label">
              <dt>{{ fact.label }}</dt>
              <dd class="tabular">{{ fact.value }}</dd>
            </div>
          </dl>
          <p v-if="usageLog.isIncomplete" class="cell-note">
            Incomplete usage: the Provider didn't report every priced token count.
          </p>
        </section>

        <section class="panel table-panel">
          <div class="panel-heading">
            <div>
              <h2>Attempts</h2>
              <p>
                Each try against a Provider Account, in order. A failed one falls back to the next.
              </p>
            </div>
          </div>
          <UsageAttemptsTable v-if="usageLog.attempts.length > 0" :attempts="usageLog.attempts" />
          <EmptyState v-else :icon="Unplug">
            <strong>No Attempts.</strong
            ><span>The gateway answered this request before trying any Provider Account.</span>
          </EmptyState>
        </section>
      </template>
    </template>
  </div>
</template>
