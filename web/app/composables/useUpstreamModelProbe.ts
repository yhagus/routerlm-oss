import { computed, shallowRef } from "vue";
import { apiErrorMessage } from "~/lib/api";
import { playgroundErrorOf, readProperty } from "~/lib/playground";
import { probePath, type ProbeResult, type ProbeResults } from "~/lib/probe";
import type { UpstreamModel } from "~/lib/upstream";

/** A finished Probe: its results, or the backend's refusal. */
export type UpstreamModelProbe =
  | { status: "done"; upstreamModel: UpstreamModel; results: ProbeResult[] }
  | { status: "refused"; upstreamModel: UpstreamModel; message: string };

/**
 * Runs Probes, several Upstream Models at once, and holds their outcomes in
 * component state only, so the results are gone once their dialog closes or
 * the page reloads. Finished Probes queue up in the order they finish: the
 * dialog shows the first, and closing it shows the next.
 */
export function useUpstreamModelProbe() {
  const { $dashboardApi } = useNuxtApp();

  const runningIds = shallowRef<ReadonlySet<string>>(new Set());
  const finishedProbes = shallowRef<readonly UpstreamModelProbe[]>([]);

  const shownProbe = computed(() => finishedProbes.value[0] ?? null);
  const isDialogOpen = computed({
    get: () => shownProbe.value !== null,
    set: (isOpen) => {
      if (!isOpen) finishedProbes.value = finishedProbes.value.slice(1);
    },
  });

  function isProbing(upstreamModel: UpstreamModel): boolean {
    return runningIds.value.has(upstreamModel.id);
  }

  function setRunning(upstreamModel: UpstreamModel, isRunning: boolean): void {
    const ids = new Set(runningIds.value);
    if (isRunning) ids.add(upstreamModel.id);
    else ids.delete(upstreamModel.id);
    runningIds.value = ids;
  }

  /** Queues the outcome, replacing an unseen earlier one for the same Upstream Model. */
  function finish(outcome: UpstreamModelProbe): void {
    const others = finishedProbes.value.filter(
      (probe) => probe.upstreamModel.id !== outcome.upstreamModel.id,
    );
    finishedProbes.value = [...others, outcome];
  }

  async function probeOnce(upstreamModel: UpstreamModel): Promise<UpstreamModelProbe> {
    try {
      const { results } = await $dashboardApi<ProbeResults>(probePath(upstreamModel), {
        method: "POST",
      });
      return { status: "done", upstreamModel, results };
    } catch (failure) {
      const refusal = playgroundErrorOf(readProperty(failure, "data"));
      return {
        status: "refused",
        upstreamModel,
        message:
          refusal?.message ?? apiErrorMessage(failure, "The probe did not reach the gateway."),
      };
    }
  }

  async function runProbe(upstreamModel: UpstreamModel): Promise<void> {
    if (isProbing(upstreamModel)) return;
    setRunning(upstreamModel, true);
    const outcome = await probeOnce(upstreamModel);
    setRunning(upstreamModel, false);
    finish(outcome);
  }

  return { shownProbe, isDialogOpen, isProbing, runProbe };
}
