const inFlight = new Set<Promise<unknown>>();

export function runInBackground(work: Promise<unknown>): void {
  const tracked = work.finally(() => {
    inFlight.delete(tracked);
  });
  inFlight.add(tracked);
}

export async function settleBackgroundWork(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled(inFlight);
  }
}
