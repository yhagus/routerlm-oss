import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { toConcurrencyWaitSetting } from '@/settings/models/concurrency-wait-view';
import type { ConcurrencyWaitSetting } from '@/settings/models/concurrency-wait';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ShowConcurrencyWaitQuery } from '@/settings/queries/impl/show-concurrency-wait.query';

@QueryHandler(ShowConcurrencyWaitQuery)
export class ShowConcurrencyWaitHandler implements IQueryHandler<ShowConcurrencyWaitQuery> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<ConcurrencyWaitSetting> {
    return toConcurrencyWaitSetting(await this.store.read('concurrencyWaitSeconds'));
  }
}
