import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { SubmitVideoJobCommand } from "@/inference/commands/impl/submit-video-job.command.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import type { PlaygroundVideoJob } from "../../models/playground-video-job.js";
import { playgroundSummaryOf } from "../../models/playground-summary.js";
import { SendPlaygroundVideoJobCommand } from "../impl/send-playground-video-job.command.js";

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
    let usage: UsageJob | undefined;
    const result = await this.commandBus.execute(
      new SubmitVideoJobCommand(
        body,
        { kind: "playground", userId: user.id },
        connection,
        (job) => {
          usage = job;
        },
        target,
      ),
    );
    if (!usage) {
      throw new Error("An answered request always reports its usage");
    }
    const response: unknown = JSON.parse(decoder.decode(result.body));
    return { response, summary: playgroundSummaryOf(usage, this.snapshot.current) };
  }
}
