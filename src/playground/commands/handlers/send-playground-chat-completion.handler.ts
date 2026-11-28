import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RunInferenceCommand } from '@/inference/commands/impl/run-inference.command';
import { openAiChatClientConverter } from '@/inference/protocols/openai-chat/openai-chat-client-converter';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { UsageJob } from '@/usage/models/usage-job';
import { playgroundSummaryOf } from '@/playground/models/playground-summary';
import { SendPlaygroundChatCompletionCommand } from '@/playground/commands/impl/send-playground-chat-completion.command';

export const SUMMARY_EVENT = 'summary';

const encoder = new TextEncoder();

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
  }: SendPlaygroundChatCompletionCommand): Promise<AsyncIterable<Uint8Array>> {
    let reportUsage: (job: UsageJob) => void = () => {};
    const usage = new Promise<UsageJob>((resolve) => {
      reportUsage = resolve;
    });
    const result = await this.commandBus.execute(
      new RunInferenceCommand(
        openAiChatClientConverter,
        body,
        { kind: 'playground', userId: user.id, userEmail: user.email },
        connection,
        reportUsage,
        target,
      ),
    );
    if (result.kind !== 'stream') {
      throw new Error('A Playground request is always streamed');
    }
    return this.followedBySummary(result.chunks, usage);
  }

  private async *followedBySummary(
    chunks: AsyncIterable<Uint8Array>,
    usage: Promise<UsageJob>,
  ): AsyncIterable<Uint8Array> {
    yield* chunks;
    const summary = playgroundSummaryOf(await usage, this.snapshot.current);
    yield encoder.encode(`event: ${SUMMARY_EVENT}\ndata: ${JSON.stringify(summary)}\n\n`);
  }
}
