import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { RunInferenceCommand } from "@/inference/commands/impl/run-inference.command.js";
import { openAiChatClientConverter } from "@/inference/protocols/openai-chat/openai-chat-client-converter.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { playgroundSummaryOf } from "../../models/playground-summary.js";
import { SendPlaygroundChatCompletionCommand } from "../impl/send-playground-chat-completion.command.js";

/** The name of the stream's last event, which carries the PlaygroundSummary. */
export const SUMMARY_EVENT = "summary";

@CommandHandler(SendPlaygroundChatCompletionCommand)
export class SendPlaygroundChatCompletionHandler implements ICommandHandler<SendPlaygroundChatCompletionCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    body,
    user,
    connection,
    target,
  }: SendPlaygroundChatCompletionCommand): Promise<AsyncIterable<string>> {
    let reportUsage: (job: UsageJob) => void = () => {};
    const usage = new Promise<UsageJob>((resolve) => {
      reportUsage = resolve;
    });
    const result = await this.commandBus.execute(
      new RunInferenceCommand(
        openAiChatClientConverter,
        body,
        { kind: "playground", userId: user.id },
        connection,
        reportUsage,
        target,
      ),
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
