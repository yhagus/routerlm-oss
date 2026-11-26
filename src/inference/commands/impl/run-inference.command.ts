import { Command } from "@nestjs/cqrs";
import type { ClientConnection } from "@/libs/models/client-connection";
import type {
  InferenceCaller,
  InferenceResult,
  RunInferenceTarget,
  UsageListener,
} from "@/inference/models/inference";
import type { ClientProtocolConverter } from "@/inference/protocols/client-protocol-converter";

export class RunInferenceCommand extends Command<InferenceResult> {
  constructor(
    readonly converter: ClientProtocolConverter,
    readonly body: unknown,
    readonly caller: InferenceCaller,
    readonly connection: ClientConnection,
    readonly onUsage: UsageListener = () => {},
    readonly target: RunInferenceTarget = { kind: "named-model" },
  ) {
    super();
  }
}
