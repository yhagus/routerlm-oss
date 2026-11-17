import { TERMS_RISK_PROVIDERS_PATH, type TermsRiskProvidersSetting } from "~/lib/settings";

/**
 * The "Allow terms-risk providers" setting, fetched once under a shared key so
 * every page agrees. A Provider is blocked when it is marked Terms Risk and the
 * setting is off; until the setting loads nothing shows as blocked, since the
 * gateway enforces the block either way.
 */
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
