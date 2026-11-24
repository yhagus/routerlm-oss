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

export interface TermsRiskProvidersSetting {
  allowed: boolean;
  defaultAllowed: boolean;
  isDefault: boolean;
}

export const TERMS_RISK_PROVIDERS_PATH = "/settings/terms-risk-providers";

export interface PrivateUpstreamsSetting {
  allowed: boolean;
  defaultAllowed: boolean;
  isDefault: boolean;
}

export const PRIVATE_UPSTREAMS_PATH = "/settings/private-upstreams";

export const TERMS_RISK_BLOCKED_HINT =
  'Turn on "Allow terms-risk providers" in Settings to use this Provider.';

export function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}
