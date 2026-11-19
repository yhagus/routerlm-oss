import { computed, shallowRef } from "vue";
import { apiErrorMessage } from "~/lib/api";
import { playgroundErrorOf, readProperty } from "~/lib/playground";
import { probePath, type ProbeResult, type ProbeResults } from "~/lib/probe";
import type { UpstreamModel } from "~/lib/upstream";

/** One Probe at a time: running, then its results or the backend's refusal. */
export type UpstreamModelProbe =
  | { status: "running"; upstreamModel: UpstreamModel }
  | { status: "done"; upstreamModel: UpstreamModel; results: ProbeResult[] }
  | { status: "refused"; upstreamModel: UpstreamModel; message: string };

/**
 * Runs a Probe and holds its outcome in component state only, so the results
 * are gone once the dialog closes or the page reloads.
 */
export function useUpstreamModelProbe() {
  const { $dashboardApi } = useNuxtApp();

  const probe = shallowRef<UpstreamModelProbe | null>(null);
  const isRunning = computed(() => probe.value?.status === "running");
  const isDialogOpen = computed({
    get: () => probe.value !== null && probe.value.status !== "running",
    set: (isOpen) => {
      if (!isOpen) probe.value = null;
    },
  });

  function isProbing(upstreamModel: UpstreamModel): boolean {
    return probe.value?.status === "running" && probe.value.upstreamModel.id === upstreamModel.id;
  }

  async function runProbe(upstreamModel: UpstreamModel): Promise<void> {
    if (isRunning.value) return;
    probe.value = { status: "running", upstreamModel };
    try {
      const { results } = await $dashboardApi<ProbeResults>(probePath(upstreamModel), {
        method: "POST",
      });
      probe.value = { status: "done", upstreamModel, results };
    } catch (failure) {
      const refusal = playgroundErrorOf(readProperty(failure, "data"));
      probe.value = {
        status: "refused",
        upstreamModel,
        message:
          refusal?.message ?? apiErrorMessage(failure, "The probe did not reach the gateway."),
      };
    }
  }

  return { probe, isRunning, isDialogOpen, isProbing, runProbe };
}
