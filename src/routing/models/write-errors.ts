import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  FOREIGN_KEY_VIOLATION,
  hasPostgresErrorCode,
  UNIQUE_VIOLATION,
} from '@/libs/models/postgres-errors';

export function toModelWriteError(error: unknown, modelName: string | undefined): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(`A Model named "${modelName ?? ''}" already exists`);
  }
  return error;
}

export function toRouteWriteError(error: unknown): unknown {
  if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new NotFoundException('Upstream Model not found');
  }
  return error;
}
