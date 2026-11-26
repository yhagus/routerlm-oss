import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { toPrivateUpstreamsSetting } from '@/settings/models/private-upstreams-view';
import type { PrivateUpstreamsSetting } from '@/settings/models/private-upstreams';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ShowPrivateUpstreamsQuery } from '@/settings/queries/impl/show-private-upstreams.query';

@QueryHandler(ShowPrivateUpstreamsQuery)
export class ShowPrivateUpstreamsHandler implements IQueryHandler<ShowPrivateUpstreamsQuery> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<PrivateUpstreamsSetting> {
    return toPrivateUpstreamsSetting(await this.store.read('allowPrivateUpstreams'));
  }
}
