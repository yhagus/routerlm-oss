import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { toErrorCaptureRetention } from '@/settings/models/error-capture-retention-view';
import type { ErrorCaptureRetention } from '@/settings/models/error-capture-retention';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ShowErrorCaptureRetentionQuery } from '@/settings/queries/impl/show-error-capture-retention.query';

@QueryHandler(ShowErrorCaptureRetentionQuery)
export class ShowErrorCaptureRetentionHandler implements IQueryHandler<ShowErrorCaptureRetentionQuery> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<ErrorCaptureRetention> {
    return toErrorCaptureRetention(await this.store.read('errorCaptureRetentionDays'));
  }
}
