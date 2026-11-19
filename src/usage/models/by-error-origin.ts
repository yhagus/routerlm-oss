import type { ErrorOrigin } from "@/db/schemas/index.js";

/**
 * One value per Error Origin, for the per-origin breakdowns of Usage Logs.
 * The only place that names the origins by hand: the Record type turns an
 * origin added to ERROR_ORIGINS into a compile error here.
 */
export function byErrorOrigin<Value>(
  valueOf: (origin: ErrorOrigin) => Value,
): Record<ErrorOrigin, Value> {
  return {
    client: valueOf("client"),
    upstream: valueOf("upstream"),
    gateway: valueOf("gateway"),
  };
}
