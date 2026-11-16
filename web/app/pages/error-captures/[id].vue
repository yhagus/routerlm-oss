<script setup lang="ts">
import { CloudOff, Unplug } from "@lucide/vue";
import { isNotFound } from "~/lib/errors";

import {
  attemptOutcomeLabel,
  clientOutcome,
  type ErrorCaptureDetail,
  failedHopLabel,
  readableBody,
} from "~/lib/errorCaptures";

const { data: capture, error: loadError } = useDashboardApi<ErrorCaptureDetail>(
  `/error-captures/${String(useRoute().params.id)}`,
);
useMissingResource(() => isNotFound(loadError.value), "Error Capture");

useHead({ title: "Error Capture" });

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

const NOTICE = "Credentials are redacted; bodies over 256 KB are truncated.";
const description = computed(() =>
  capture.value
    ? `Captured ${timeFormat.format(new Date(capture.value.createdAt))}. ${NOTICE}`
    : NOTICE,
);
const attemptHop = computed(() =>
  capture.value?.failedHop.kind === "gateway-to-provider-account" ? capture.value.failedHop : null,
);
</script>

<template>
  <div class="page-view">
    <EmptyState v-if="loadError" class="panel" :icon="CloudOff" tone="error">
      <strong>Couldn't load this Error Capture.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>

    <template v-else>
      <PageHeading title="Error Capture" :description="description" />

      <section v-if="!capture" class="panel loading-panel" aria-busy="true">
        <AppSpinner />
      </section>

      <template v-else>
        <section class="panel capture-panel">
          <header class="panel-heading">
            <div>
              <h2>Failed at: {{ failedHopLabel(capture.failedHop) }}</h2>
              <p v-if="attemptHop">
                The gateway's Attempt on this Provider Account failed:
                {{ attemptOutcomeLabel(attemptHop) }}.
              </p>
              <p v-else>The request failed at the gateway, before any Attempt failed.</p>
            </div>
          </header>
          <dl class="capture-facts">
            <div>
              <dt>Client got</dt>
              <dd>
                <span :class="['status-badge', clientOutcome(capture).badgeClass]">{{
                  clientOutcome(capture).label
                }}</span>
              </dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{{ capture.modelName ?? "—" }}</dd>
            </div>
            <div>
              <dt>API Key</dt>
              <dd>{{ capture.isPlayground ? "Playground" : (capture.apiKeyName ?? "—") }}</dd>
            </div>
            <div>
              <dt>Protocol</dt>
              <dd>{{ capture.clientProtocol }}</dd>
            </div>
            <div>
              <dt>Usage Log</dt>
              <dd>
                <NuxtLink :to="`/error-captures?usageLogId=${capture.usageLogId}`"
                  >Every capture of this request</NuxtLink
                >
              </dd>
            </div>
          </dl>
        </section>

        <section class="panel capture-panel">
          <header class="panel-heading">
            <div>
              <h2>Client request</h2>
              <p>What the client sent to the gateway.</p>
            </div>
          </header>
          <dl class="capture-headers">
            <div v-for="(value, name) in capture.requestHeaders" :key="name">
              <dt>{{ name }}</dt>
              <dd>{{ value }}</dd>
            </div>
          </dl>
          <pre class="capture-body">{{ readableBody(capture.requestBody) }}</pre>
        </section>

        <section v-if="attemptHop" class="panel capture-panel">
          <header class="panel-heading">
            <div>
              <h2>Upstream response</h2>
              <p>What the Provider answered this Attempt.</p>
            </div>
          </header>
          <template v-if="capture.responseHeaders !== null">
            <dl class="capture-headers">
              <div v-for="(value, name) in capture.responseHeaders" :key="name">
                <dt>{{ name }}</dt>
                <dd>{{ value }}</dd>
              </div>
            </dl>
            <pre class="capture-body">{{ readableBody(capture.responseBody ?? "") }}</pre>
          </template>
          <EmptyState v-else :icon="Unplug">
            <strong>No response arrived.</strong
            ><span>The Attempt timed out, lost its connection, or its stream was cut short.</span>
          </EmptyState>
        </section>
      </template>
    </template>
  </div>
</template>
