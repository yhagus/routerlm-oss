<script setup lang="ts">
import { ArrowLeft, CloudOff, Unplug } from "@lucide/vue";
import { ERROR_ORIGIN_LABELS } from "~/lib/errorOrigins";
import { isNotFound } from "~/lib/errors";
import { SERVICE_TIER_LABELS } from "~/lib/parameterPolicy";
import {
  formatCost,
  formatCount,
  formatDuration,
  USAGE_STATUS_BADGES,
  USAGE_STATUS_LABELS,
  type UsageLogDetail,
  usageStatusOf,
} from "~/lib/usage";

const { data: usageLog, error: loadError } = useDashboardApi<UsageLogDetail>(
  `/usage/${String(useRoute().params.id)}`,
);
useMissingResource(() => isNotFound(loadError.value), "Usage Log");

useHead({ title: "Usage Log" });

const backTo = computed(() => {
  const previous: unknown = window.history.state?.back;
  return typeof previous === "string" && /^\/usage(\?|$)/.test(previous) ? previous : "/usage";
});

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

const description = computed(() =>
  usageLog.value
    ? `Requested ${timeFormat.format(new Date(usageLog.value.createdAt))}.`
    : "One client request and the Attempts the gateway made for it.",
);

const status = computed(() => (usageLog.value ? usageStatusOf(usageLog.value) : null));

const apiKeyLabel = computed(() => {
  const log = usageLog.value;
  if (!log) return "—";
  if (log.isPlayground) return "Playground";
  return log.apiKeyName ?? (log.apiKeyId ? "Deleted API Key" : "—");
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
              <h2>{{ usageLog.modelName ?? (usageLog.modelId ? "Deleted Model" : "No Model") }}</h2>
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
            <template v-if="usageLog.integrationId">
              <div>
                <dt>Integration</dt>
                <dd>{{ usageLog.integrationName ?? "—" }}</dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd>{{ usageLog.customerId ?? "—" }}</dd>
              </div>
            </template>
            <div>
              <dt>Upstream Protocol</dt>
              <dd>{{ usageLog.upstreamProtocol ?? "—" }}</dd>
            </div>
            <div>
              <dt>Error Origin</dt>
              <dd>{{ usageLog.errorOrigin ? ERROR_ORIGIN_LABELS[usageLog.errorOrigin] : "—" }}</dd>
            </div>
            <div>
              <dt>User-Agent</dt>
              <dd>{{ usageLog.userAgent ?? "—" }}</dd>
            </div>
            <div>
              <dt>IP</dt>
              <dd class="tabular">{{ usageLog.clientIp ?? "—" }}</dd>
            </div>
            <div>
              <dt>Tier</dt>
              <dd>
                {{ usageLog.serviceTier ? SERVICE_TIER_LABELS[usageLog.serviceTier] : "Default" }}
              </dd>
            </div>
            <div>
              <dt>Streamed</dt>
              <dd>{{ usageLog.isStreamed ? "Yes" : "No" }}</dd>
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
              <dt>First token</dt>
              <dd class="tabular">{{ formatDuration(usageLog.timeToFirstTokenMs) }}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd class="tabular">{{ formatDuration(usageLog.durationMs) }}</dd>
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
