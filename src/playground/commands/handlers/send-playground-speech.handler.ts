import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RunMediaInferenceCommand } from '@/inference/commands/impl/run-media-inference.command';
import { openAiSpeechClientContract } from '@/inference/protocols/openai-speech/openai-speech-client-contract';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { PlaygroundSpeech } from '@/playground/models/playground-speech';
import { PlaygroundUsage } from '@/playground/models/playground-usage';
import { SendPlaygroundSpeechCommand } from '@/playground/commands/impl/send-playground-speech.command';

@CommandHandler(SendPlaygroundSpeechCommand)
export class SendPlaygroundSpeechHandler implements ICommandHandler<SendPlaygroundSpeechCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    body,
    user,
    connection,
    target,
  }: SendPlaygroundSpeechCommand): Promise<PlaygroundSpeech> {
    const usage = new PlaygroundUsage();
    const reply = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        openAiSpeechClientContract,
        body,
        { kind: 'playground', userId: user.id, userEmail: user.email },
        connection,
        usage.record,
        target,
      ),
    );
    return {
      audio: { contentType: reply.contentType, base64: Buffer.from(reply.body).toString('base64') },
      summary: usage.summaryAt(this.snapshot.current),
    };
  }
}
