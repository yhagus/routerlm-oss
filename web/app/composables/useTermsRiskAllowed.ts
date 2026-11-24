import { TERMS_RISK_PROVIDERS_PATH, type TermsRiskProvidersSetting } from "~/lib/settings";

export function useTermsRiskAllowed() {
  const {
    data: setting,
    error,
    status,
    refresh,
  } = useDashboardApi<TermsRiskProvidersSetting>(TERMS_RISK_PROVIDERS_PATH, {
    key: TERMS_RISK_PROVIDERS_PATH,
  });

  function isBlocked(provider: { termsRisk: boolean }): boolean {
    return provider.termsRisk && setting.value?.allowed === false;
  }

  return { setting, error, status, refresh, isBlocked };
}
