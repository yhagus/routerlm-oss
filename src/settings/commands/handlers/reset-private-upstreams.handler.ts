import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { toPrivateUpstreamsSetting } from "../../models/private-upstreams-view.js";
import type { PrivateUpstreamsSetting } from "../../models/private-upstreams.js";
import { SETTING_DEFINITIONS } from "../../models/setting-definitions.js";
import { SettingsStore } from "../../providers/settings-store.js";
import { ResetPrivateUpstreamsCommand } from "../impl/reset-private-upstreams.command.js";

@CommandHandler(ResetPrivateUpstreamsCommand)
export class ResetPrivateUpstreamsHandler implements ICommandHandler<ResetPrivateUpstreamsCommand> {
  constructor(
    private readonly store: SettingsStore,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute(): Promise<PrivateUpstreamsSetting> {
    await this.store.reset("allowPrivateUpstreams");
    await this.snapshot.changed();
    return toPrivateUpstreamsSetting({
      value: SETTING_DEFINITIONS.allowPrivateUpstreams.default,
      isDefault: true,
    });
  }
}
