import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { Env } from '@/config/schemas/env.schema';
import { GatewayError } from '@/inference/models/gateway-error';
import type { ClientConnection } from '@/libs/models/client-connection';
import type { SnapshotProviderAccount } from '@/snapshot/models/snapshot';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { User } from '@/users/models/user';
import { PlaygroundUsage } from '@/playground/models/playground-usage';
import { type ProbePlan, probePlanFor } from '@/playground/models/probe-plan';
import { probeCommandFor } from '@/playground/models/probe-requests';
import {
  type ProbeResult,
  type ProbeResults,
  probeResultOf,
} from '@/playground/models/probe-result';
import { ProbeUpstreamModelCommand } from '@/playground/commands/impl/probe-upstream-model.command';

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
        kind: 'probe',
        upstreamModelId: upstreamModel.id,
        providerAccountId: providerAccount.id,
        totalTimeoutMs: this.config.get(
          kind === 'image' ? 'PROBE_IMAGE_TIMEOUT_MS' : 'PROBE_TIMEOUT_MS',
          { infer: true },
        ),
      },
      caller: { kind: 'playground', userId: user.id },
      connection,
      onUsage: usage.record,
    });
    try {
      await this.commandBus.execute(command);
    } catch (error) {
      if (!(error instanceof GatewayError)) {
        this.logger.error(
          `Probe of Upstream Model ${upstreamModel.id} with Provider Account ${providerAccount.id} failed`,
          error,
        );
      }
    }
    return probeResultOf(usage.job, upstreamModel, providerAccount, this.snapshot.current);
  }
}
