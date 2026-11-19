import { Command } from "@nestjs/cqrs";
import type { PrivateUpstreamsSetting } from "../../models/private-upstreams.js";

/** Returns the private-upstreams Setting to its default, which refuses private upstreams. */
export class ResetPrivateUpstreamsCommand extends Command<PrivateUpstreamsSetting> {}
