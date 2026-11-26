import type { ErrorOrigin } from "@/db/schemas";

export function byErrorOrigin<Value>(
  valueOf: (origin: ErrorOrigin) => Value,
): Record<ErrorOrigin, Value> {
  return {
    client: valueOf("client"),
    upstream: valueOf("upstream"),
    gateway: valueOf("gateway"),
  };
}
