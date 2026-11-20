import { Command } from "@nestjs/cqrs";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { User } from "@/users/models/user.js";
import type { ProbeResults } from "../../models/probe-result.js";

/**
 * A User's Probe of one Upstream Model (GLOSSARY "Probe"): its Kind's fixed
 * request, sent once with each enabled Provider Account of its Provider, at
 * once and with no Fallback. Each call is recorded as Playground traffic;
 * no Provider Account's state changes.
 */
export class ProbeUpstreamModelCommand extends Command<ProbeResults> {
  constructor(
    readonly upstreamModelId: string,
    readonly user: User,
    readonly connection: ClientConnection,
  ) {
    super();
  }
}
