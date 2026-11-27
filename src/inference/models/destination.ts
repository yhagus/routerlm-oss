import { mayUseModel, mayUseUpstreamModels } from '@/api-keys/models/api-key';
import type { ModelKind } from '@/db/schemas';
import { DIRECT_UPSTREAM_SLUG } from '@/libs/models/direct-upstream';
import {
  isUpstreamModelReachableDirectly,
  isUpstreamModelUsable,
  type Snapshot,
  type SnapshotModel,
  type SnapshotUpstreamModel,
} from '@/snapshot/models/snapshot';
import { GatewayError } from './gateway-error';
import type { InferenceCaller, ProbeTarget } from './inference';
import type { AttemptPath, AttemptTarget } from './route-selection';

export type Destination = FallbackDestination | ProbeDestination;

export const GROUP_SEPARATOR = '/';

export const DIRECT_UPSTREAM_PREFIX = `${DIRECT_UPSTREAM_SLUG}${GROUP_SEPARATOR}`;

export type ClientModelTarget =
  | { kind: 'model'; model: SnapshotModel }
  | { kind: 'upstream-model'; upstreamModel: SnapshotUpstreamModel };

interface ResolvedNames {
  model: SnapshotModel | null;
  id: string;
  name: string;
}

export interface FallbackDestination extends ResolvedNames {
  kind: 'fallback';
  paths: AttemptPath[];
}

export interface ProbeDestination extends ResolvedNames {
  kind: 'probe';
  target: AttemptTarget;
  totalTimeoutMs: number;
}

export function clientModelTargetOf(
  snapshot: Snapshot,
  name: string,
  caller: InferenceCaller,
): ClientModelTarget {
  if (!snapshot.modelsByName.has(name) && name.startsWith(DIRECT_UPSTREAM_PREFIX)) {
    return { kind: 'upstream-model', upstreamModel: directUpstreamModel(snapshot, name, caller) };
  }
  return { kind: 'model', model: usableModel(snapshot, name, caller) };
}

function directUpstreamModel(
  snapshot: Snapshot,
  name: string,
  caller: InferenceCaller,
): SnapshotUpstreamModel {
  const upstreamModel = findUpstreamModelByDirectName(snapshot, name);
  const isReachable =
    caller.kind === 'api-key' &&
    mayUseUpstreamModels(caller.principal) &&
    upstreamModel !== undefined &&
    isUpstreamModelReachableDirectly(upstreamModel);
  if (!isReachable) {
    throw modelNotFound(name);
  }
  return upstreamModel;
}

function findUpstreamModelByDirectName(
  snapshot: Snapshot,
  name: string,
): SnapshotUpstreamModel | undefined {
  const providerPath = name.slice(DIRECT_UPSTREAM_PREFIX.length);
  const separatorIndex = providerPath.indexOf(GROUP_SEPARATOR);
  if (separatorIndex === -1) {
    return undefined;
  }
  const providerSlug = providerPath.slice(0, separatorIndex);
  const upstreamModelName = providerPath.slice(separatorIndex + 1);
  return snapshot.upstreamModelsByProviderSlug.get(providerSlug)?.get(upstreamModelName);
}

function modelNotFound(name: string): GatewayError {
  return new GatewayError('model_not_found', `The Model "${name}" does not exist`, 'client');
}

function usableModel(snapshot: Snapshot, name: string, caller: InferenceCaller): SnapshotModel {
  const model = findModelByClientName(snapshot, name);
  if (!model?.isEnabled) {
    throw modelNotFound(name);
  }
  if (caller.kind === 'api-key' && !mayUseModel(caller.principal, model)) {
    throw new GatewayError(
      'model_not_allowed',
      `This API Key may not use the Model "${name}"`,
      'client',
    );
  }
  return model;
}

function findModelByClientName(snapshot: Snapshot, name: string): SnapshotModel | undefined {
  const exactMatch = snapshot.modelsByName.get(name);
  if (exactMatch) {
    return exactMatch;
  }
  const separatorIndex = name.indexOf(GROUP_SEPARATOR);
  if (separatorIndex === -1) {
    return undefined;
  }
  const groupSlug = name.slice(0, separatorIndex);
  const model = snapshot.modelsByName.get(name.slice(separatorIndex + 1));
  return model?.groupSlugs.includes(groupSlug) ? model : undefined;
}

export function upstreamModelServedHere(
  snapshot: Snapshot,
  upstreamModelRowId: string,
  endpointKind: ModelKind,
): SnapshotUpstreamModel {
  const upstreamModel = snapshot.upstreamModelsById.get(upstreamModelRowId);
  if (upstreamModel === undefined || !isUpstreamModelUsable(upstreamModel)) {
    throw new GatewayError(
      'model_not_found',
      `The Upstream Model "${upstreamModelRowId}" does not exist`,
      'client',
    );
  }
  assertKindServedHere(
    `Upstream Model "${upstreamModel.upstreamModelId}"`,
    upstreamModel.kind,
    endpointKind,
  );
  return upstreamModel;
}

export function probeDestination(
  snapshot: Snapshot,
  { upstreamModelId, providerAccountId, totalTimeoutMs }: ProbeTarget,
  endpointKind: ModelKind,
): ProbeDestination {
  const upstreamModel = snapshot.upstreamModelsById.get(upstreamModelId);
  const providerAccount = upstreamModel?.provider.providerAccounts.find(
    (account) => account.id === providerAccountId,
  );
  if (!upstreamModel || !providerAccount) {
    throw new GatewayError(
      'model_not_found',
      `The Upstream Model "${upstreamModelId}" has no Provider Account "${providerAccountId}"`,
      'client',
    );
  }
  assertKindServedHere(
    `Upstream Model "${upstreamModel.upstreamModelId}"`,
    upstreamModel.kind,
    endpointKind,
  );
  return {
    kind: 'probe',
    model: null,
    id: upstreamModel.id,
    name: upstreamModel.upstreamModelId,
    target: { route: null, upstreamModel, providerAccount },
    totalTimeoutMs,
  };
}

export function assertKindServedHere(
  named: string,
  itsKind: ModelKind,
  endpointKind: ModelKind,
): void {
  if (itsKind !== endpointKind) {
    throw new GatewayError(
      'invalid_request',
      `The ${named} has the Kind ${itsKind}, but this endpoint serves the Kind ${endpointKind}`,
      'client',
    );
  }
}
