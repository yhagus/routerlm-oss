<script setup lang="ts">
import { ArrowLeft, CloudOff, Unplug } from "@lucide/vue";
import { isNotFound } from "~/lib/errors";

import {
  attemptOutcomeLabel,
  clientOutcome,
  type ErrorCaptureDetail,
  failedHopLabel,
  upstreamErrorMessage,
} from "~/lib/errorCaptures";

const { data: capture, error: loadError } = useDashboardApi<ErrorCaptureDetail>(
  `/error-captures/${String(useRoute().params.id)}`,
);
useMissingResource(() => isNotFound(loadError.value), "Error Capture");

useHead({ title: "Error Capture" });

/**
 * Back goes to the list the reader came from, with its filter, search and
 * page, and to the plain list when they arrived by a direct link.
 */
const backTo = computed(() => {
  const previous: unknown = window.history.state?.back;
  return typeof previous === "string" && /^\/error-captures(\?|$)/.test(previous)
    ? previous
    : "/error-captures";
});

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

const NOTICE = "Credentials are redacted; bodies over 256 KB are truncated.";
const description = computed(() =>
  capture.value
    ? `Captured ${timeFormat.format(new Date(capture.value.createdAt))}. ${NOTICE}`
    : NOTICE,
);
/** What the Provider said went wrong, when its body says so. */
const cause = computed(() => upstreamErrorMessage(capture.value?.responseBody ?? null));
const attemptHop = computed(() =>
  capture.value?.failedHop.kind === "gateway-to-provider-account" ? capture.value.failedHop : null,
);
</script>

<template>
  <div class="page-view">
    <NuxtLink class="back-link" :to="backTo"><ArrowLeft :size="13" /> Error Captures</NuxtLink>

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
        <section class="panel capture-summary">
          <header class="capture-summary__head">
            <div>
              <h2>Failed at: {{ failedHopLabel(capture.failedHop) }}</h2>
              <p v-if="attemptHop">
                The gateway's Attempt on this Provider Account failed:
                {{ attemptOutcomeLabel(attemptHop) }}.
              </p>
              <p v-else>The request failed at the gateway, before any Attempt failed.</p>
            </div>
            <p class="capture-outcome">
              <span class="capture-outcome__label">Client got</span>
              <span :class="['status-badge', clientOutcome(capture).badgeClass]">{{
                clientOutcome(capture).label
              }}</span>
            </p>
          </header>
          <p v-if="cause" class="capture-cause">
            <span class="capture-cause__label">Upstream said</span>
            <span class="capture-cause__text" :title="cause">{{ cause }}</span>
          </p>
          <dl class="capture-facts">
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
                <NuxtLink
                  class="capture-link"
                  :to="`/error-captures?usageLogId=${capture.usageLogId}`"
                  >Every capture of this request</NuxtLink
                >
              </dd>
            </div>
          </dl>
        </section>

        <div class="capture-columns" :class="{ 'capture-columns--single': !attemptHop }">
          <ErrorCapturePane
            title="Client request"
            description="What the client sent to the gateway."
            :headers="capture.requestHeaders"
            :body="capture.requestBody"
          />
          <template v-if="attemptHop">
            <ErrorCapturePane
              v-if="capture.responseHeaders !== null"
              title="Upstream response"
              description="What the Provider answered this Attempt."
              :headers="capture.responseHeaders"
              :body="capture.responseBody ?? ''"
            />
            <section v-else class="panel capture-pane">
              <header class="capture-pane__head">
                <div class="capture-pane__title">
                  <h2>Upstream response</h2>
                  <p>What the Provider answered this Attempt.</p>
                </div>
              </header>
              <EmptyState :icon="Unplug">
                <strong>No response arrived.</strong
                ><span
                  >The Attempt timed out, lost its connection, or its stream was cut short.</span
                >
              </EmptyState>
            </section>
          </template>
        </div>
      </template>
    </template>
  </div>
</template>
