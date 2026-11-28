import type { INestApplicationContext } from '@nestjs/common';
import { AttemptRunner } from '@/inference/providers/attempt-runner';

const attemptRunners = new Set<AttemptRunner>();

export function trackQuotaReadingsOf(app: INestApplicationContext): void {
  attemptRunners.add(app.get(AttemptRunner));
}

export async function settleQuotaReadings(): Promise<void> {
  await Promise.all([...attemptRunners].map((runner) => runner.settleQuotaReadings()));
}
