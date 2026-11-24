const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
