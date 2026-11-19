import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { toPrivateUpstreamsSetting } from "../../models/private-upstreams-view.js";
import type { PrivateUpstreamsSetting } from "../../models/private-upstreams.js";
import { SettingsStore } from "../../providers/settings-store.js";
import { ShowPrivateUpstreamsQuery } from "../impl/show-private-upstreams.query.js";

@QueryHandler(ShowPrivateUpstreamsQuery)
export class ShowPrivateUpstreamsHandler implements IQueryHandler<ShowPrivateUpstreamsQuery> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<PrivateUpstreamsSetting> {
    return toPrivateUpstreamsSetting(await this.store.read("allowPrivateUpstreams"));
  }
}
