// Alibaba Model Studio (alims-intl) free-tier tracking.
//
// Model Studio answers a request for a model whose free allotment is spent with
// HTTP 403 and error.code === "AllocationQuota.FreeTierOnly". That is a stable
// per-model, per-account condition (not a transient rate limit), so it is
// persisted as a dedicated marker and cleared only when a request for the same
// model succeeds again, or when an operator resets it.
export const ALIMS_INTL_PROVIDER = "alims-intl";
export const ALIMS_FREE_TIER_EXHAUSTED_CODE = "AllocationQuota.FreeTierOnly";
export const ALIMS_EXHAUSTED_MARKER_PREFIX = "alimsFreeTierExhausted_";

/**
 * True when an upstream failure is Alibaba's free-tier exhaustion for a model.
 * Requires the provider, the exact 403 status, and the provider error code.
 */
export function isAlimsFreeTierExhausted(provider: string, status: number, code: string | null | undefined): boolean {
  if (provider !== ALIMS_INTL_PROVIDER) return false;
  if (status !== 403) return false;
  return String(code || "").trim() === ALIMS_FREE_TIER_EXHAUSTED_CODE;
}

/** Flat data field that marks one model exhausted for one account. */
export function alimsExhaustedMarkerKey(model: string | null | undefined): string {
  return `${ALIMS_EXHAUSTED_MARKER_PREFIX}${model || "__all"}`;
}

/** True when the connection data bag carries an active exhaustion marker. */
export function isAlimsModelExhausted(data: Record<string, unknown> | null | undefined, model: string | null | undefined): boolean {
  if (!data) return false;
  return data[alimsExhaustedMarkerKey(model)] === true;
}
