import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Env } from "@/config/schemas/env.schema.js";
import { GatewayError } from "@/inference/models/gateway-error.js";
import type { ClientConnection } from "@/libs/models/client-connection.js";
import type { SnapshotProviderAccount } from "@/snapshot/models/snapshot.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { User } from "@/users/models/user.js";
import { PlaygroundUsage } from "@/playground/models/playground-usage.js";
import { type ProbePlan, probePlanFor } from "@/playground/models/probe-plan.js";
import { probeCommandFor } from "@/playground/models/probe-requests.js";
import {
  type ProbeResult,
  type ProbeResults,
  probeResultOf,
} from "@/playground/models/probe-result.js";
import { ProbeUpstreamModelCommand } from "@/playground/commands/impl/probe-upstream-model.command.js";

@CommandHandler(ProbeUpstreamModelCommand)
export class ProbeUpstreamModelHandler implements ICommandHandler<ProbeUpstreamModelCommand> {
  private readonly logger = new Logger(ProbeUpstreamModelHandler.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly snapshot: SnapshotService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async execute({
    upstreamModelId,
    user,
    connection,
  }: ProbeUpstreamModelCommand): Promise<ProbeResults> {
    const plan = probePlanFor(this.snapshot.current, upstreamModelId);
    const results = await Promise.all(
      plan.providerAccounts.map((providerAccount) =>
        this.probeWith(plan, providerAccount, user, connection),
      ),
    );
    return { results };
  }

  /** One Probe call, with its own deadline; however it fails, its result says why. */
  private async probeWith(
    { upstreamModel, kind }: ProbePlan,
    providerAccount: SnapshotProviderAccount,
    user: User,
    connection: ClientConnection,
  ): Promise<ProbeResult> {
    const usage = new PlaygroundUsage();
    const command = probeCommandFor(kind, {
      upstreamModel,
      target: {
        kind: "probe",
        upstreamModelId: upstreamModel.id,
        providerAccountId: providerAccount.id,
        totalTimeoutMs: this.config.get(
          kind === "image" ? "PROBE_IMAGE_TIMEOUT_MS" : "PROBE_TIMEOUT_MS",
          { infer: true },
        ),
      },
      caller: { kind: "playground", userId: user.id },
      connection,
      onUsage: usage.record,
    });
    try {
      await this.commandBus.execute(command);
    } catch (error) {
      // A GatewayError is the failure the result reports; anything else is a
      // bug, which the result reports as the gateway's.
      if (!(error instanceof GatewayError)) {
        this.logger.error(
          `Probe of Upstream Model ${upstreamModel.id} with Provider Account ${providerAccount.id} failed`,
          error,
        );
      }
    }
    return probeResultOf(usage.job, providerAccount, this.snapshot.current);
  }
}
