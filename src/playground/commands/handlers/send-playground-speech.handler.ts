import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { RunMediaInferenceCommand } from "@/inference/commands/impl/run-media-inference.command.js";
import { openAiSpeechClientContract } from "@/inference/protocols/openai-speech/openai-speech-client-contract.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import type { PlaygroundSpeech } from "../../models/playground-speech.js";
import { playgroundSummaryOf } from "../../models/playground-summary.js";
import { SendPlaygroundSpeechCommand } from "../impl/send-playground-speech.command.js";

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
    let usage: UsageJob | undefined;
    const reply = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        openAiSpeechClientContract,
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
    return {
      audio: { contentType: reply.contentType, base64: Buffer.from(reply.body).toString("base64") },
      summary: playgroundSummaryOf(usage, this.snapshot.current),
    };
  }
}
