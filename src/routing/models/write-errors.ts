import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  FOREIGN_KEY_VIOLATION,
  hasPostgresErrorCode,
  UNIQUE_VIOLATION,
} from "@/libs/models/postgres-errors.js";

/** Turns a duplicate Model name into a 409; any other error passes through unchanged. */
export function toModelWriteError(error: unknown, modelName: string | undefined): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(`A Model named "${modelName ?? ""}" already exists`);
  }
  return error;
}

/** Turns a missing Upstream Model into a 404; any other error passes through unchanged. */
export function toRouteWriteError(error: unknown): unknown {
  // Adding a Route checks its Model first, and updating one never changes its
  // Model, so a foreign-key failure here means a missing Upstream Model.
  if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new NotFoundException("Upstream Model not found");
  }
  return error;
}
