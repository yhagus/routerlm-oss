import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { RunMediaInferenceCommand } from "@/inference/commands/impl/run-media-inference.command.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { PlaygroundImageGeneration } from "../../models/playground-image-generation.js";
import { PlaygroundUsage } from "../../models/playground-usage.js";
import { SendPlaygroundImageGenerationCommand } from "../impl/send-playground-image-generation.command.js";

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
