import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  FOREIGN_KEY_VIOLATION,
  hasPostgresErrorCode,
  UNIQUE_VIOLATION,
} from "../../db/models/postgres-errors.js";
import type { upstreamModels } from "../../db/schemas/index.js";

/** An Upstream Model as the dashboard API returns it. */
export type UpstreamModel = typeof upstreamModels.$inferSelect;

/** The HTTP error for a failed Upstream Model insert or update, or the original error. */
export function toUpstreamModelWriteError(
  error: unknown,
  providerModelName: string | undefined,
): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(
      `The Provider already has an Upstream Model named "${providerModelName ?? ""}"`,
    );
  }
  if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new NotFoundException("Provider not found");
  }
  return error;
}
