/**
 * Whether the gateway may send inference through a Provider. A Terms Risk
 * Provider is unusable, though still enabled, until a User allows them.
 */
export function providerIsUsable(
  provider: { isEnabled: boolean; termsRisk: boolean },
  allowsTermsRiskProviders: boolean,
): boolean {
  return provider.isEnabled && (allowsTermsRiskProviders || !provider.termsRisk);
}
