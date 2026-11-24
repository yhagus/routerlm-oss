import { Command } from "@nestjs/cqrs";
import type { PrivateUpstreamsSetting } from "@/settings/models/private-upstreams.js";

export class ResetPrivateUpstreamsCommand extends Command<PrivateUpstreamsSetting> {}
