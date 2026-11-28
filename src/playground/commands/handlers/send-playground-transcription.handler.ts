import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RunMediaInferenceCommand } from '@/inference/commands/impl/run-media-inference.command';
import { openAiTranscriptionClientContract } from '@/inference/protocols/openai-transcription/openai-transcription-client-contract';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { PlaygroundTranscription } from '@/playground/models/playground-transcription';
import { PlaygroundUsage } from '@/playground/models/playground-usage';
import { SendPlaygroundTranscriptionCommand } from '@/playground/commands/impl/send-playground-transcription.command';

@CommandHandler(SendPlaygroundTranscriptionCommand)
export class SendPlaygroundTranscriptionHandler implements ICommandHandler<SendPlaygroundTranscriptionCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    body,
    user,
    connection,
    target,
  }: SendPlaygroundTranscriptionCommand): Promise<PlaygroundTranscription> {
    const usage = new PlaygroundUsage();
    const reply = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        openAiTranscriptionClientContract,
        asksForPlainText(body),
        { kind: 'playground', userId: user.id, userEmail: user.email },
        connection,
        usage.record,
        target,
      ),
    );
    return {
      text: new TextDecoder().decode(reply.body),
      summary: usage.summaryAt(this.snapshot.current),
    };
  }
}

function asksForPlainText(body: unknown): unknown {
  return typeof body === 'object' && body !== null ? { ...body, response_format: 'text' } : body;
}
