const DAY_MS = 24 * 60 * 60 * 1000;

/** Error Captures created before this moment are past a Retention Period of `days`. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
