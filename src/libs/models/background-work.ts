import { Logger } from '@nestjs/common';

const logger = new Logger('BackgroundWork');
const inFlight = new Set<Promise<void>>();

export function trackBackgroundWork<T>(work: Promise<T>): Promise<T> {
  const settled: Promise<void> = work.then(ignoreOutcome, ignoreOutcome).finally(() => {
    inFlight.delete(settled);
  });
  inFlight.add(settled);
  return work;
}

export function runInBackground(work: Promise<unknown>): void {
  trackBackgroundWork(work).catch((error: unknown) => {
    logger.error(`Background work failed: ${String(error)}`);
  });
}

export async function settleBackgroundWork(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.all(inFlight);
  }
}

function ignoreOutcome(): void {}
