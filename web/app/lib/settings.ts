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

/** Whether Providers marked Terms Risk may be used, as the dashboard API returns it. */
export interface TermsRiskProvidersSetting {
  allowed: boolean;
  defaultAllowed: boolean;
  isDefault: boolean;
}

export const TERMS_RISK_PROVIDERS_PATH = "/settings/terms-risk-providers";

/** Whether Provider URLs may be http or point at private hosts (ADR 0030), as the dashboard API returns it. */
export interface PrivateUpstreamsSetting {
  allowed: boolean;
  defaultAllowed: boolean;
  isDefault: boolean;
}

export const PRIVATE_UPSTREAMS_PATH = "/settings/private-upstreams";

/** Tooltip for the "Blocked: terms risk" note. */
export const TERMS_RISK_BLOCKED_HINT =
  'Turn on "Allow terms-risk providers" in Settings to use this Provider.';

/** "1 day" or "7 days". */
export function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}
