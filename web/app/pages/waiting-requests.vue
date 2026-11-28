<script setup lang="ts">
import { CloudOff, Hourglass } from '@lucide/vue';
import { computed } from 'vue';
import type { DataTableColumn } from '~/lib/dataTable';
import { dateTimeFormat } from '~/lib/dateFormats';
import {
  apiKeyLink,
  apiKeyNameOf,
  callerSearchText,
  customerLabel,
  formatWaitDuration,
  lineOccupancyLabel,
  ordinal,
  playgroundCallerLabel,
  type WaitingRequest,
  type WaitingRequestList,
} from '~/lib/waitingRequests';

useHead({ title: 'Waiting Requests' });

const REFRESH_INTERVAL_MS = 2000;

const {
  data: waitingList,
  error: loadError,
  status,
  refresh,
} = useDashboardApi<WaitingRequestList>('/waiting-requests');

function refreshWaitingRequests(): Promise<void> {
  return refresh({ dedupe: 'defer' });
}

usePollWhileVisible(refreshWaitingRequests, REFRESH_INTERVAL_MS);

const isLoading = computed(() => status.value === 'pending' && !waitingList.value);
const isUnavailable = computed(() => waitingList.value?.available === false);
const lines = computed(() => waitingList.value?.lines ?? []);

const columns: DataTableColumn<WaitingRequest>[] = [
  { id: 'waitingSince', header: 'Waiting since', enableHiding: false },
  { id: 'caller', header: 'Caller', accessorFn: (request) => callerSearchText(request.caller) },
  {
    id: 'model',
    header: 'Requested Model',
    accessorFn: (request) => request.requestedModelName ?? '',
  },
  { id: 'waitsFor', header: 'Waits for' },
  { id: 'refusedIn', header: 'Refused in' },
  { id: 'stream', header: 'Stream' },
  { id: 'clientIp', header: 'Client IP', accessorFn: (request) => request.clientIp ?? '' },
  { id: 'userAgent', header: 'User-Agent', accessorFn: (request) => request.userAgent ?? '' },
];
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Waiting Requests"
      description="Requests admitted but waiting for a slot under a Concurrency Limit."
    />

    <EmptyState v-if="isUnavailable" :icon="CloudOff" tone="error">
      <strong>Concurrency Limits aren't being enforced because Redis is unreachable.</strong>
    </EmptyState>

    <template v-else>
      <section v-if="lines.length" class="panel" aria-label="Concurrency Limits with a queue">
        <ul class="waiting-lines">
          <li
            v-for="line in lines"
            :key="`${line.holder.kind}:${line.holder.id}`"
            class="waiting-lines__item"
          >
            <WaitingHolderLink :holder="line.holder" />
            <span class="tabular">{{ lineOccupancyLabel(line) }}</span>
          </li>
        </ul>
      </section>

      <DataTable
        table-id="waiting-requests"
        label="Waiting Requests"
        search-placeholder="Search caller, model, IP or user-agent"
        :columns="columns"
        :rows="waitingList?.requests ?? []"
        :get-row-id="(request) => request.id"
        :is-loading="isLoading"
        :error="loadError"
        :refresh="refreshWaitingRequests"
      >
        <template #cell-waitingSince="{ row: request }">
          <span class="tabular">{{ dateTimeFormat.format(new Date(request.waitingSince)) }}</span>
          <span class="cell-note tabular">waited {{ formatWaitDuration(request.waitedMs) }}</span>
        </template>
        <template #cell-caller="{ row: request }">
          <template v-if="request.caller.kind === 'api-key'">
            <NuxtLink
              v-if="request.caller.apiKeyName !== null"
              :to="apiKeyLink(request.caller.apiKeyName)"
              >{{ request.caller.apiKeyName }}</NuxtLink
            >
            <template v-else>{{ apiKeyNameOf(null) }}</template>
            <span v-if="request.caller.customer" class="cell-note">
              {{ customerLabel(request.caller.customer) }}
            </span>
          </template>
          <template v-else-if="request.caller.kind === 'playground'">
            {{ playgroundCallerLabel(request.caller.userEmail) }}
          </template>
          <template v-else>Unidentified</template>
        </template>
        <template #cell-model="{ row: request }">{{ request.requestedModelName ?? '—' }}</template>
        <template #cell-waitsFor="{ row: request }">
          {{ ordinal(request.bestPlace.place) }} for
          <WaitingHolderLink :holder="request.bestPlace.holder" />
          <span v-if="request.otherHolders.length" class="cell-note">
            Also:
            <template
              v-for="(holder, index) in request.otherHolders"
              :key="`${holder.kind}:${holder.id}`"
              ><template v-if="index > 0">, </template><WaitingHolderLink :holder="holder"
            /></template>
          </span>
        </template>
        <template #cell-refusedIn="{ row: request }">
          <span class="tabular">{{ formatWaitDuration(request.msUntilRefused) }}</span>
        </template>
        <template #cell-stream="{ row: request }">{{ request.isStreamed ? 'Yes' : 'No' }}</template>
        <template #cell-clientIp="{ row: request }">
          <span class="tabular">{{ request.clientIp ?? '—' }}</span>
        </template>
        <template #cell-userAgent="{ row: request }">
          <span class="waiting-user-agent" :title="request.userAgent ?? undefined">{{
            request.userAgent ?? '—'
          }}</span>
        </template>
        <template #empty>
          <EmptyState :icon="Hourglass">
            <strong>No requests are waiting.</strong>
          </EmptyState>
        </template>
      </DataTable>
    </template>
  </div>
</template>

<style scoped>
.waiting-lines {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.waiting-lines__item {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 10px 21px;
  color: var(--ink);
  font-size: 13px;
}
.waiting-lines__item + .waiting-lines__item {
  border-top: 1px solid var(--line-soft);
}
.waiting-lines__item .tabular {
  color: var(--muted);
}
.waiting-user-agent {
  display: block;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
