import type { SnapshotProviderAccount, SnapshotUpstreamModel } from '@/snapshot/models/snapshot';

export function isOutsidePlanCoverage(
  providerAccount: SnapshotProviderAccount,
  upstreamModel: SnapshotUpstreamModel,
): boolean {
  const { plan, paysBeyondPlan } = providerAccount;
  const { planCoverage } = upstreamModel;
  if (plan === null || paysBeyondPlan || planCoverage === null) {
    return false;
  }
  return !planCoverage.includes(plan);
}
