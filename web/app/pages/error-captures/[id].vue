<script setup lang="ts">
import {
  attemptOutcomeLabel,
  type ErrorCaptureDetail,
  failedHopLabel,
  readableBody,
} from "~/lib/errorCaptures";

const { data: capture, error: loadError } = await useDashboardApi<ErrorCaptureDetail>(
  `/error-captures/${String(useRoute().params.id)}`,
);

useHead({ title: "Error Capture" });

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

const attemptHop = computed(() =>
  capture.value?.failedHop.kind === "gateway-to-provider-account" ? capture.value.failedHop : null,
);
</script>

<template>
  <div v-if="loadError" class="panel empty-state">
    <strong>Couldn't load this Error Capture.</strong
    ><span
      >It may have passed the retention period.
      <NuxtLink to="/error-captures">Back to Error Captures</NuxtLink></span
    >
  </div>

  <template v-else-if="capture">
    <PageHeading
      title="Error Capture"
      :description="`Captured ${timeFormat.format(new Date(capture.createdAt))}. Credentials are redacted; bodies over 256 KB are truncated.`"
    />

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
            <span class="status-badge status-badge--bad"
              >{{ capture.errorCode ?? "error" }} · {{ capture.httpStatus }}</span
            >
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
      <div v-else class="empty-state">
        <strong>No response arrived.</strong
        ><span>The Attempt timed out, lost its connection, or its stream was cut short.</span>
      </div>
    </section>
  </template>
</template>
