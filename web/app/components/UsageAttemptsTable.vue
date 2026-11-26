<script setup lang="ts">
import { attemptOutcomeLabel } from '~/lib/errorCaptures';
import { formatDuration, type UsageLogAttempt } from '~/lib/usage';

defineProps<{
  attempts: UsageLogAttempt[];
}>();
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
            {{ attempt.providerName ?? 'Deleted Provider' }}
            <span class="cell-note">{{
              attempt.providerAccountName ?? 'Deleted Provider Account'
            }}</span>
          </td>
          <td>{{ attempt.upstreamModelName ?? attempt.upstreamModelId ?? '—' }}</td>
          <td>
            <span
              class="status-badge"
              :class="attempt.failureReason ? 'status-badge--bad' : 'status-badge--good'"
              >{{ attemptOutcomeLabel(attempt, 'Answered') }}</span
            >
          </td>
          <td class="tabular">{{ attempt.upstreamRequestId ?? '—' }}</td>
          <td class="tabular">{{ formatDuration(attempt.durationMs) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
