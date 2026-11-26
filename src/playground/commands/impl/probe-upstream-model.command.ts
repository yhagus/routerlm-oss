import { Command } from '@nestjs/cqrs';
import type { ClientConnection } from '@/libs/models/client-connection';
import type { User } from '@/users/models/user';
import type { ProbeResults } from '@/playground/models/probe-result';

export class ProbeUpstreamModelCommand extends Command<ProbeResults> {
  constructor(
    readonly upstreamModelId: string,
    readonly user: User,
    readonly connection: ClientConnection,
  ) {
    super();
  }
}
