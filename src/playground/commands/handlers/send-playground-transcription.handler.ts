import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { RunMediaInferenceCommand } from "@/inference/commands/impl/run-media-inference.command.js";
import { openAiTranscriptionClientContract } from "@/inference/protocols/openai-transcription/openai-transcription-client-contract.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import type { PlaygroundTranscription } from "../../models/playground-transcription.js";
import { playgroundSummaryOf } from "../../models/playground-summary.js";
import { SendPlaygroundTranscriptionCommand } from "../impl/send-playground-transcription.command.js";

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
    let usage: UsageJob | undefined;
    const reply = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        openAiTranscriptionClientContract,
        asksForPlainText(body),
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
      text: new TextDecoder().decode(reply.body),
      summary: playgroundSummaryOf(usage, this.snapshot.current),
    };
  }
}

/** The Playground shows the transcript alone, so it always asks for plain text. */
function asksForPlainText(body: unknown): unknown {
  return typeof body === "object" && body !== null ? { ...body, response_format: "text" } : body;
}
