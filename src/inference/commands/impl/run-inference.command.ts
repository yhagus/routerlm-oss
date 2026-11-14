import { Command } from "@nestjs/cqrs";
import type { ClientConnection } from "../../models/client-connection.js";
import type { InferenceCaller, InferenceResult, UsageListener } from "../../models/inference.js";
import type { ClientProtocolConverter } from "../../protocols/client-protocol-converter.js";

/**
 * Serves an inference request in the converter's client Protocol and enqueues
 * its usage job once it is answered (spec step 9). `onUsage` sees the same
 * job, for a caller that reports it back.
 */
export class RunInferenceCommand extends Command<InferenceResult> {
  constructor(
    readonly converter: ClientProtocolConverter,
    readonly body: unknown,
    readonly caller: InferenceCaller,
    readonly connection: ClientConnection,
    readonly onUsage: UsageListener = () => {},
  ) {
    super();
  }
}
