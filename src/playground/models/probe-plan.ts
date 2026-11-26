import type { ModelKind } from '@/db/schemas';
import { GatewayError } from '@/inference/models/gateway-error';
import type {
  Snapshot,
  SnapshotProviderAccount,
  SnapshotUpstreamModel,
} from '@/snapshot/models/snapshot';

const PROBED_KINDS = ['chat', 'image', 'speech', 'transcription'] as const;
export type ProbedKind = (typeof PROBED_KINDS)[number];

export interface ProbePlan {
  upstreamModel: SnapshotUpstreamModel;
  kind: ProbedKind;
  providerAccounts: SnapshotProviderAccount[];
}

export function probePlanFor(snapshot: Snapshot, upstreamModelId: string): ProbePlan {
  const upstreamModel = snapshot.upstreamModelsById.get(upstreamModelId);
  if (!upstreamModel) {
    throw new GatewayError(
      'model_not_found',
      `The Upstream Model "${upstreamModelId}" does not exist`,
      'client',
    );
  }
  const { kind, provider } = upstreamModel;
  if (!isProbedKind(kind)) {
    throw new GatewayError(
      'invalid_request',
      `A Probe can't check an Upstream Model of the Kind ${kind}`,
      'client',
    );
  }
  if (provider.isRefusedForTermsRisk) {
    throw new GatewayError(
      'invalid_request',
      `The Provider "${provider.name}" has a Terms Risk, and terms-risk Providers are not allowed`,
      'client',
    );
  }
  const providerAccounts = provider.providerAccounts.filter((account) => account.isEnabled);
  if (providerAccounts.length === 0) {
    throw new GatewayError(
      'invalid_request',
      `The Provider "${provider.name}" has no enabled Provider Account to probe with`,
      'client',
    );
  }
  return { upstreamModel, kind, providerAccounts };
}

function isProbedKind(kind: ModelKind): kind is ProbedKind {
  return PROBED_KINDS.some((probed) => probed === kind);
}
