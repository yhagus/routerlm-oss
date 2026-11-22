import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { toPrivateUpstreamsSetting } from "@/settings/models/private-upstreams-view.js";
import type { PrivateUpstreamsSetting } from "@/settings/models/private-upstreams.js";
import { SettingsStore } from "@/settings/providers/settings-store.js";
import { ChangePrivateUpstreamsCommand } from "@/settings/commands/impl/change-private-upstreams.command.js";

@CommandHandler(ChangePrivateUpstreamsCommand)
export class ChangePrivateUpstreamsHandler implements ICommandHandler<ChangePrivateUpstreamsCommand> {
  constructor(
    private readonly store: SettingsStore,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ allowed }: ChangePrivateUpstreamsCommand): Promise<PrivateUpstreamsSetting> {
    await this.store.write("allowPrivateUpstreams", allowed);
    await this.snapshot.changed();
    return toPrivateUpstreamsSetting({ value: allowed, isDefault: false });
  }
}
