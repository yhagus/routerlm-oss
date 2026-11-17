/** The Retention Period as the dashboard shows it. */
export interface ErrorCaptureRetention {
  days: number;
  defaultDays: number;
  isDefault: boolean;
  min: number;
  max: number;
}

/** How many Error Captures a Retention Period of `days` would delete right now. */
export interface ErrorCaptureRetentionImpact {
  deleteCount: number;
}
