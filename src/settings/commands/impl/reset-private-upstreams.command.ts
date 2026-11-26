import { Command } from '@nestjs/cqrs';
import type { PrivateUpstreamsSetting } from '@/settings/models/private-upstreams';

export class ResetPrivateUpstreamsCommand extends Command<PrivateUpstreamsSetting> {}
