import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { RunMediaInferenceCommand } from "@/inference/commands/impl/run-media-inference.command.js";
import { openAiImagesClientContract } from "@/inference/protocols/openai-images/openai-images-client-contract.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import type { PlaygroundImageGeneration } from "../../models/playground-image-generation.js";
import { playgroundSummaryOf } from "../../models/playground-summary.js";
import { SendPlaygroundImageGenerationCommand } from "../impl/send-playground-image-generation.command.js";

const decoder = new TextDecoder();

@CommandHandler(SendPlaygroundImageGenerationCommand)
export class SendPlaygroundImageGenerationHandler implements ICommandHandler<SendPlaygroundImageGenerationCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    body,
    user,
    connection,
    target,
  }: SendPlaygroundImageGenerationCommand): Promise<PlaygroundImageGeneration> {
    let usage: UsageJob | undefined;
    const result = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        openAiImagesClientContract,
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
    const response: unknown = JSON.parse(decoder.decode(result.json));
    return { response, summary: playgroundSummaryOf(usage, this.snapshot.current) };
  }
}
