export interface ErrorCaptureRetention {
  days: number;
  defaultDays: number;
  isDefault: boolean;
  min: number;
  max: number;
}

export interface ErrorCaptureRetentionImpact {
  deleteCount: number;
}
