import { Command } from "@nestjs/cqrs";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { ProbeResults } from "@/playground/models/probe-result.js";

export class ProbeUpstreamModelCommand extends Command<ProbeResults> {
  constructor(
    readonly upstreamModelId: string,
    readonly user: User,
    readonly connection: ClientConnection,
  ) {
    super();
  }
}
