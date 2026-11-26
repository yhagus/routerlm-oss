import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { SubmitVideoJobCommand } from "@/inference/commands/impl/submit-video-job.command";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import type { PlaygroundVideoJob } from "@/playground/models/playground-video-job";
import { PlaygroundUsage } from "@/playground/models/playground-usage";
import { SendPlaygroundVideoJobCommand } from "@/playground/commands/impl/send-playground-video-job.command";

const decoder = new TextDecoder();

@CommandHandler(SendPlaygroundVideoJobCommand)
export class SendPlaygroundVideoJobHandler implements ICommandHandler<SendPlaygroundVideoJobCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    body,
    user,
    connection,
    target,
  }: SendPlaygroundVideoJobCommand): Promise<PlaygroundVideoJob> {
    const usage = new PlaygroundUsage();
    const result = await this.commandBus.execute(
      new SubmitVideoJobCommand(
        body,
        { kind: "playground", userId: user.id },
        connection,
        usage.record,
        target,
      ),
    );
    const response: unknown = JSON.parse(decoder.decode(result.body));
    return { response, summary: usage.summaryAt(this.snapshot.current) };
  }
}
