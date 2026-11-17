/** The Error Capture Retention Period as the dashboard API returns it. */
export interface ErrorCaptureRetention {
  days: number;
  defaultDays: number;
  isDefault: boolean;
  min: number;
  max: number;
}

export interface ErrorCaptureImpact {
  deleteCount: number;
}

export const ERROR_CAPTURE_RETENTION_PATH = "/settings/error-capture-retention";

/** "1 day" or "7 days". */
export function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}
