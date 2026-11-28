import { type BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';

const SHUTDOWN_WAIT_MS = 5000;

@Injectable()
export class BackgroundWork implements BeforeApplicationShutdown {
  private readonly logger = new Logger(BackgroundWork.name);
  private readonly inFlight = new Set<Promise<void>>();

  track<T>(work: Promise<T>): Promise<T> {
    const settled: Promise<void> = work.then(ignoreOutcome, ignoreOutcome).finally(() => {
      this.inFlight.delete(settled);
    });
    this.inFlight.add(settled);
    return work;
  }

  run(work: Promise<unknown>): void {
    this.track(work).catch((error: unknown) => {
      this.logger.error(`Background work failed: ${String(error)}`);
    });
  }

  async settle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(this.inFlight);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), SHUTDOWN_WAIT_MS);
    });
    const isSettled = await Promise.race([this.settle().then(() => true), timedOut]);
    clearTimeout(timer);
    if (!isSettled) {
      this.logger.warn(
        `Shutting down with ${this.inFlight.size} background tasks still running after ${SHUTDOWN_WAIT_MS} ms`,
      );
    }
  }
}

function ignoreOutcome(): void {}
