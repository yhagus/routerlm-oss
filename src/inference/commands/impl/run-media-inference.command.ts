import { Command } from "@nestjs/cqrs";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type {
  InferenceCaller,
  InferenceResult,
  InferenceTarget,
  UsageListener,
} from "../../models/inference.js";
import type { MediaClientContract, MediaRequest } from "../../models/media-kind.js";

/**
 * Serves a request of a media Kind through the Kind's client contract, with
 * the same Attempts, Fallback and usage job as chat (spec "Kind-aware
 * inference pipeline"). `onUsage` sees the job too; `target` is the Model
 * the body names unless a direct Upstream Model test says otherwise.
 */
export class RunMediaInferenceCommand<
  Request extends MediaRequest = MediaRequest,
  Result = unknown,
> extends Command<Extract<InferenceResult, { kind: "response" }>> {
  constructor(
    readonly contract: MediaClientContract<Request, Result>,
    readonly body: unknown,
    readonly caller: InferenceCaller,
    readonly connection: ClientConnection,
    readonly onUsage: UsageListener = () => {},
    readonly target: InferenceTarget = { kind: "named-model" },
  ) {
    super();
  }
}
