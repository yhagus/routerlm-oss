import { ConflictException } from '@nestjs/common';
import { hasPostgresErrorCode, UNIQUE_VIOLATION } from '@/libs/models/postgres-errors';

export function toModelGroupWriteError(error: unknown, slug: string | undefined): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(`A Model Group with the slug "${slug ?? ''}" already exists`);
  }
  return error;
}
