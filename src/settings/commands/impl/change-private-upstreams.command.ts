import { Command } from "@nestjs/cqrs";
import type { PrivateUpstreamsSetting } from "../../models/private-upstreams.js";

/** Lifts or restores both Provider URL rules: write-time and connect-time (ADR 0019). */
export class ChangePrivateUpstreamsCommand extends Command<PrivateUpstreamsSetting> {
  constructor(readonly allowed: boolean) {
    super();
  }
}
