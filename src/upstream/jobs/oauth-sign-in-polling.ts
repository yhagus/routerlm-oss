import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import type { Job, Queue } from 'bullmq';
import { BackgroundWork } from '@/libs/providers/background-work';
import { OAUTH_SIGN_INS_QUEUE } from '@/queue/models/queue-names';
import { signInNeedsRedis } from '@/upstream/models/oauth-sign-in';
import { PollOauthSignInCommand } from '@/upstream/commands/impl/poll-oauth-sign-in.command';

const POLL_JOB = 'poll';
const POLL_ATTEMPTS = 3;
const POLL_RETRY_BACKOFF = { type: 'exponential', delay: 1000 } as const;

type PollJob = Job<{ signInId: string }>;

@Injectable()
export class OauthSignInPolling {
  constructor(@InjectQueue(OAUTH_SIGN_INS_QUEUE) private readonly queue: Queue) {}

  async pollIn(signInId: string, delayMs: number): Promise<void> {
    try {
      await this.queue.add(
        POLL_JOB,
        { signInId },
        {
          delay: delayMs,
          attempts: POLL_ATTEMPTS,
          backoff: POLL_RETRY_BACKOFF,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      throw signInNeedsRedis(error);
    }
  }
}

@Processor(OAUTH_SIGN_INS_QUEUE)
export class OauthSignInPollingProcessor extends WorkerHost {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly backgroundWork: BackgroundWork,
  ) {
    super();
  }

  async process(job: PollJob): Promise<void> {
    await this.backgroundWork.track(
      this.commandBus.execute(new PollOauthSignInCommand(job.data.signInId)),
    );
  }
}
