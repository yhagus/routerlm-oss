<script setup lang="ts">
import { ChevronLeft, ChevronRight, CloudOff, ShieldCheck } from "@lucide/vue";
import { failedHopLabel, type ErrorCapturePage } from "~/lib/errorCaptures";
import { formatCount } from "~/lib/usage";

useHead({ title: "Error Captures" });

const PAGE_SIZE = 50;

const route = useRoute();
/** Set when a Usage Log links here: only that request's captures. */
const usageLogId = computed(() =>
  typeof route.query.usageLogId === "string" ? route.query.usageLogId : undefined,
);
const page = useQueryPage();
watch(usageLogId, () => {
  page.value = 1;
});

const {
  data: capturePage,
  status: captureStatus,
  error: loadError,
} = useDashboardApi<ErrorCapturePage>("/error-captures", {
  query: computed(() => ({
    usageLogId: usageLogId.value,
    page: page.value,
    pageSize: PAGE_SIZE,
  })),
});

/** Placeholder rows only while there is nothing to show yet. */
const isLoading = computed(() => captureStatus.value === "pending" && !capturePage.value);
const captures = computed(() => capturePage.value?.items ?? []);
const total = computed(() => capturePage.value?.total ?? 0);
const firstShown = computed(() => (total.value === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1));
const lastShown = computed(() => Math.min(page.value * PAGE_SIZE, total.value));
const hasNextPage = computed(() => lastShown.value < total.value);

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Error Captures"
      description="Headers and bodies of failed requests and failed Attempts, credentials redacted. Deleted after the retention period."
    />

    <p v-if="usageLogId" class="filter-note">
      Showing the captures of one request.
      <NuxtLink to="/error-captures">Show all</NuxtLink>
    </p>

    <section class="panel table-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Failed at</th>
              <th>Model</th>
              <th>API Key</th>
              <th>Client got</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <LoadingRow v-if="isLoading" :columns="6" />
            <tr v-for="capture in captures" :key="capture.id">
              <td class="tabular">{{ timeFormat.format(new Date(capture.createdAt)) }}</td>
              <td>
                <strong>{{ failedHopLabel(capture.failedHop) }}</strong>
              </td>
              <td>{{ capture.modelName ?? "—" }}</td>
              <td>{{ capture.isPlayground ? "Playground" : (capture.apiKeyName ?? "—") }}</td>
              <td>
                <span class="status-badge status-badge--bad"
                  >{{ capture.errorCode ?? "error" }} · {{ capture.httpStatus }}</span
                >
              </td>
              <td>
                <NuxtLink class="row-action" :to="`/error-captures/${capture.id}`">View</NuxtLink>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-if="loadError" :icon="CloudOff" tone="error">
          <strong>Couldn't load Error Captures.</strong
          ><span>Check that the backend is running, then reload the page.</span>
        </EmptyState>
        <EmptyState v-else-if="!isLoading && captures.length === 0" :icon="ShieldCheck">
          <strong>No Error Captures.</strong
          ><span
            >Failed requests with a valid API Key are captured here. Successful requests and
            requests without a valid key never are.</span
          >
        </EmptyState>
      </div>
      <footer class="panel-footer">
        <AppSpinner v-if="isLoading" label="" />
        <span v-else class="tabular"
          >{{ formatCount(firstShown) }}–{{ formatCount(lastShown) }} of
          {{ formatCount(total) }}</span
        >
        <div class="row-actions">
          <button class="row-action" type="button" :disabled="page === 1" @click="page -= 1">
            <ChevronLeft :size="14" /> Previous
          </button>
          <button class="row-action" type="button" :disabled="!hasNextPage" @click="page += 1">
            Next <ChevronRight :size="14" />
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>
