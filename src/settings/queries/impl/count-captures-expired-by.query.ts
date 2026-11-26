import { Query } from '@nestjs/cqrs';
import type { ErrorCaptureRetentionImpact } from '@/settings/models/error-capture-retention';

export class CountCapturesExpiredByQuery extends Query<ErrorCaptureRetentionImpact> {
  constructor(readonly days: number) {
    super();
  }
}
