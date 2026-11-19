import { Command } from "@nestjs/cqrs";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type {
  InferenceCaller,
  InferenceResult,
  InferenceTarget,
  ProbeTarget,
  UsageListener,
} from "../../models/inference.js";
import type { ClientProtocolConverter } from "../../protocols/client-protocol-converter.js";

/**
 * Serves an inference request in the converter's client Protocol and enqueues
 * its usage job once it is answered (spec step 9). `onUsage` sees the same
 * job, for a caller that reports it back. `target` is the Model the body
 * names unless a direct Upstream Model test or a Probe says otherwise.
 */
export class RunInferenceCommand extends Command<InferenceResult> {
  constructor(
    readonly converter: ClientProtocolConverter,
    readonly body: unknown,
    readonly caller: InferenceCaller,
    readonly connection: ClientConnection,
    readonly onUsage: UsageListener = () => {},
    readonly target: InferenceTarget | ProbeTarget = { kind: "named-model" },
  ) {
    super();
  }
}
