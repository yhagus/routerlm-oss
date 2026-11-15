import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { Job, Queue } from "bullmq";
import { OAUTH_SIGN_INS_QUEUE } from "@/queue/models/queue-names.js";
import { PollOauthSignInCommand } from "../commands/impl/poll-oauth-sign-in.command.js";

const POLL_JOB = "poll";

type PollJob = Job<{ signInId: string }>;

/**
 * Polls for pending sign-ins with one delayed job per poll, so the wait
 * between polls is held by the queue and not by a process: the backend
 * enqueues the first poll, the worker runs each one and enqueues the next,
 * and a restart of either loses nothing.
 */
@Injectable()
export class OauthSignInPolling {
  constructor(@InjectQueue(OAUTH_SIGN_INS_QUEUE) private readonly queue: Queue) {}

  /** Has the worker poll for the sign-in once, `delayMs` from now. Throws ServiceUnavailableException without Redis. */
  async pollIn(signInId: string, delayMs: number): Promise<void> {
    try {
      await this.queue.add(
        POLL_JOB,
        { signInId },
        { delay: delayMs, removeOnComplete: true, removeOnFail: true },
      );
    } catch (error) {
      throw new ServiceUnavailableException("Sign-in needs Redis, which is unreachable", {
        cause: error,
      });
    }
  }
}

/** Registered only in WorkerModule, like every processor. */
@Processor(OAUTH_SIGN_INS_QUEUE)
export class OauthSignInPollingProcessor extends WorkerHost {
  constructor(private readonly commandBus: CommandBus) {
    super();
  }

  async process(job: PollJob): Promise<void> {
    await this.commandBus.execute(new PollOauthSignInCommand(job.data.signInId));
  }
}
