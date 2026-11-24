import { Command } from "@nestjs/cqrs";
import type { PrivateUpstreamsSetting } from "@/settings/models/private-upstreams.js";

export class ChangePrivateUpstreamsCommand extends Command<PrivateUpstreamsSetting> {
  constructor(readonly allowed: boolean) {
    super();
  }
}
