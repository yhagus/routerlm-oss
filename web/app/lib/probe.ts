// Probe (GLOSSARY "Probe"): one call to an Upstream Model with each of its
// Provider's enabled Provider Accounts, so an operator can see which work.

import type { ErrorOrigin } from "~/lib/errorOrigins";
import type { ProviderAccount, UpstreamModel } from "~/lib/upstream";

/** How a Probe call with one Provider Account went, as `POST …/probe` answers it. */
export interface ProbeResult {
  providerAccountId: string;
  providerAccountName: string;
  /** The upstream answered 2xx with a well-formed response for the Kind. */
  ok: boolean;
  latencyMs: number;
  /** Null when no response arrived (a timeout, a connection error). */
  upstreamStatus: number | null;
  /** Why the call's last Attempt failed; null on success. */
  failureReason: string | null;
  /** Null on success. */
  errorOrigin: ErrorOrigin | null;
  /** The upstream's error body, truncated and redacted; null with no error response. */
  errorMessage: string | null;
  /** The call's Error Capture, which the worker writes shortly after the answer; null on success. */
  errorCaptureId: string | null;
  /** USD; null on failure, or when the Upstream Model's prices are unknown. */
  cost: number | null;
}

export interface ProbeResults {
  /** One per enabled Provider Account, in priority order. */
  results: ProbeResult[];
}

export function probePath(upstreamModel: Pick<UpstreamModel, "id">): string {
  return `/playground/upstream-models/${upstreamModel.id}/probe`;
}

/**
 * Why an Upstream Model can't be probed, or null when it can. The backend
 * refuses the same cases; this only says so before the click. A disabled
 * Upstream Model or Provider can still be probed. `providerAccounts` is
 * undefined until its list loads, and then only the Kind can block.
 */
export function probeBlockReason(
  upstreamModel: Pick<UpstreamModel, "kind" | "providerId">,
  providerAccounts: Pick<ProviderAccount, "providerId" | "isEnabled">[] | undefined,
): string | null {
  if (upstreamModel.kind === "video") {
    return "Video models can't be probed: their jobs run too long.";
  }
  if (!providerAccounts) return null;
  const hasEnabledAccount = providerAccounts.some(
    (account) => account.providerId === upstreamModel.providerId && account.isEnabled,
  );
  return hasEnabledAccount ? null : "Its Provider has no enabled Provider Account to probe with.";
}
