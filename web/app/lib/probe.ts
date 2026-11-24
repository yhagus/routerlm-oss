import type { RecordedAttemptFailure } from "~/lib/attemptFailures";
import type { ErrorOrigin } from "~/lib/errorOrigins";
import type { ProviderAccount, UpstreamModel } from "~/lib/upstream";

export interface ProbeResult {
  providerAccountId: string;
  providerAccountName: string;
  ok: boolean;
  latencyMs: number;
  upstreamStatus: number | null;
  failureReason: RecordedAttemptFailure | null;
  errorOrigin: ErrorOrigin | null;
  errorMessage: string | null;
  errorCaptureId: string | null;
  cost: number | null;
}

export interface ProbeResults {
  results: ProbeResult[];
}

export function probePath(upstreamModel: Pick<UpstreamModel, "id">): string {
  return `/playground/upstream-models/${upstreamModel.id}/probe`;
}

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
