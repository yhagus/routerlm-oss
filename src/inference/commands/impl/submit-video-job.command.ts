import { Command } from "@nestjs/cqrs";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type {
  InferenceCaller,
  InferenceResult,
  InferenceTarget,
  UsageListener,
} from "../../models/inference.js";

/**
 * Submits a Video Job (`POST /v1/videos`) through the media inference path,
 * with Fallback, and answers with a queued video whose id is the job's
 * sealed handle (ADR 0027). Its one Usage Log is written now.
 */
export class SubmitVideoJobCommand extends Command<Extract<InferenceResult, { kind: "response" }>> {
  constructor(
    readonly body: unknown,
    readonly caller: InferenceCaller,
    readonly connection: ClientConnection,
    readonly onUsage: UsageListener = () => {},
    readonly target: InferenceTarget = { kind: "named-model" },
  ) {
    super();
  }
}
