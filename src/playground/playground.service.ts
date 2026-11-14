import { Injectable } from "@nestjs/common";
import type { ClientConnection } from "../inference/client-connection.js";
import { InferenceService } from "../inference/inference.service.js";
import { openAiChatClientConverter } from "../inference/protocols/openai-chat/openai-chat-client-converter.js";
import { SnapshotService } from "../snapshot/providers/snapshot.service.js";
import type { UsageJob } from "../usage/models/usage-job.js";
import type { User } from "../users/models/user.js";
import { playgroundSummaryOf } from "./playground-summary.js";
import type { PlaygroundRequest } from "./playground.schemas.js";

/** The name of the stream's last event, which carries the PlaygroundSummary. */
export const SUMMARY_EVENT = "summary";

/**
 * Sends a User's Playground request through the same inference path as a
 * client request, in the Chat Completions wire format. Keeps no conversation:
 * the browser sends all of it every time.
 */
@Injectable()
export class PlaygroundService {
  constructor(
    private readonly inference: InferenceService,
    private readonly snapshot: SnapshotService,
  ) {}

  /** The Chat Completions event stream, followed by a summary event. */
  async sendChatCompletion(
    body: PlaygroundRequest,
    user: User,
    client: ClientConnection,
  ): Promise<AsyncIterable<string>> {
    let reportUsage: (job: UsageJob) => void = () => {};
    const usage = new Promise<UsageJob>((resolve) => {
      reportUsage = resolve;
    });
    const result = await this.inference.infer(
      openAiChatClientConverter,
      body,
      { kind: "playground", userId: user.id },
      client,
      reportUsage,
    );
    if (result.kind !== "stream") {
      throw new Error("A Playground request is always streamed");
    }
    return this.followedBySummary(result.chunks, usage);
  }

  private async *followedBySummary(
    chunks: AsyncIterable<string>,
    usage: Promise<UsageJob>,
  ): AsyncIterable<string> {
    yield* chunks;
    const summary = playgroundSummaryOf(await usage, this.snapshot.current);
    yield `event: ${SUMMARY_EVENT}\ndata: ${JSON.stringify(summary)}\n\n`;
  }
}
