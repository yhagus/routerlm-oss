import type { AttemptFailureReason } from "@/db/schemas/index.js";
import { failureReasonOfStatus } from "@/inference/providers/upstream-client.js";

/**
 * The Fallback reason of a failed answer from DashScope's native API, shared
 * by every DashScope Protocol. DashScope names the cause in the body's `code`
 *; a code not
 * listed here falls back to the HTTP status, which also carries ADR 0023's
 * 403 rule.
 */
export function dashScopeFailureReasonOf(status: number, body: string): AttemptFailureReason {
  const code = errorCodeOf(body);
  if (code === "InvalidApiKey") {
    return "unauthorized";
  }
  if (code?.startsWith("Throttling")) {
    return "rate_limited";
  }
  // The account's balance is overdue: every request on it fails until it is paid.
  if (code === "Arrearage") {
    return "exhausted";
  }
  // Content inspection refused the prompt or an input: another account would too.
  if (code === "DataInspectionFailed") {
    return "bad_request";
  }
  return failureReasonOfStatus(status);
}

function errorCodeOf(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "code" in parsed) {
      return typeof parsed.code === "string" ? parsed.code : undefined;
    }
  } catch {
    // A body that is not JSON names no code.
  }
  return undefined;
}
