import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RunMediaInferenceCommand } from '@/inference/commands/impl/run-media-inference.command';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { PlaygroundImageGeneration } from '@/playground/models/playground-image-generation';
import { PlaygroundUsage } from '@/playground/models/playground-usage';
import { SendPlaygroundImageGenerationCommand } from '@/playground/commands/impl/send-playground-image-generation.command';

const decoder = new TextDecoder();

@CommandHandler(SendPlaygroundImageGenerationCommand)
export class SendPlaygroundImageGenerationHandler implements ICommandHandler<SendPlaygroundImageGenerationCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    contract,
    body,
    user,
    connection,
    target,
  }: SendPlaygroundImageGenerationCommand): Promise<PlaygroundImageGeneration> {
    const usage = new PlaygroundUsage();
    const result = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        contract,
        body,
        { kind: 'playground', userId: user.id },
        connection,
        usage.record,
        target,
      ),
    );
    const response: unknown = JSON.parse(decoder.decode(result.body));
    return { response, summary: usage.summaryAt(this.snapshot.current) };
  }
}
