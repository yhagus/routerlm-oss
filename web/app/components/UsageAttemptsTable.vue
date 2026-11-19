<script setup lang="ts">
import { failureReasonLabel } from "~/lib/errorCaptures";
import { formatDuration, type UsageLogAttempt } from "~/lib/usage";

/** A Usage Log's Attempts, in the order the gateway tried them. */
defineProps<{
  attempts: UsageLogAttempt[];
}>();

/** How the Attempt ended: "Answered · HTTP 200", "Timed out · no response". */
function attemptOutcome(attempt: UsageLogAttempt): string {
  const reason = attempt.failureReason ? failureReasonLabel(attempt.failureReason) : "Answered";
  return attempt.upstreamStatus === null
    ? `${reason} · no response`
    : `${reason} · HTTP ${attempt.upstreamStatus}`;
}
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Provider</th>
          <th>Upstream Model</th>
          <th>Outcome</th>
          <th>Provider request id</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(attempt, index) in attempts" :key="attempt.id">
          <td class="tabular">{{ index + 1 }}</td>
          <td>
            {{ attempt.providerName ?? "Deleted Provider" }}
            <span class="cell-note">{{
              attempt.providerAccountName ?? "Deleted Provider Account"
            }}</span>
          </td>
          <td>{{ attempt.upstreamModelName ?? attempt.upstreamModelId ?? "—" }}</td>
          <td>
            <span
              class="status-badge"
              :class="attempt.failureReason ? 'status-badge--bad' : 'status-badge--good'"
              >{{ attemptOutcome(attempt) }}</span
            >
          </td>
          <td class="tabular">{{ attempt.upstreamRequestId ?? "—" }}</td>
          <td class="tabular">{{ formatDuration(attempt.durationMs) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
