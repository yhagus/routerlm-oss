export function providerIsUsable(
  provider: { isEnabled: boolean; termsRisk: boolean },
  allowsTermsRiskProviders: boolean,
): boolean {
  return provider.isEnabled && (allowsTermsRiskProviders || !provider.termsRisk);
}
