import { CAPABILITIES, type Capability, type UpstreamModel } from '~/lib/upstream';

export interface UpstreamModelGroup {
  upstreamModelId: string;
  members: [UpstreamModel, ...UpstreamModel[]];
}

export type UpstreamModelRow = UpstreamModel | UpstreamModelGroup;

export function isUpstreamModelGroup(row: UpstreamModelRow): row is UpstreamModelGroup {
  return 'members' in row;
}

export function groupBySharedId(
  models: UpstreamModel[],
  compare: (first: UpstreamModel, second: UpstreamModel) => number,
): UpstreamModelRow[] {
  const modelsById = new Map<string, UpstreamModel[]>();
  for (const model of models) {
    const sameId = modelsById.get(model.upstreamModelId);
    if (sameId) sameId.push(model);
    else modelsById.set(model.upstreamModelId, [model]);
  }
  const rows: UpstreamModelRow[] = [];
  for (const [upstreamModelId, sameId] of modelsById) {
    const [first, ...rest] = sameId.toSorted(compare);
    if (!first) continue;
    rows.push(rest.length === 0 ? first : { upstreamModelId, members: [first, ...rest] });
  }
  const leadOf = (row: UpstreamModelRow): UpstreamModel =>
    isUpstreamModelGroup(row) ? row.members[0] : row;
  return rows.toSorted((first, second) => compare(leadOf(first), leadOf(second)));
}

export function groupName(group: UpstreamModelGroup): string | null {
  return group.members.find((model) => model.name !== null)?.name ?? null;
}

export function groupCapabilities(group: UpstreamModelGroup): Capability[] {
  return CAPABILITIES.filter((capability) =>
    group.members.some((model) => model.capabilities.includes(capability)),
  );
}

export function rangeOf<Value>(
  values: (Value | null)[],
  compare: (first: Value, second: Value) => number,
): { min: Value; max: Value } | null {
  const sorted = values.filter((value): value is Value => value !== null).toSorted(compare);
  const min = sorted[0];
  const max = sorted.at(-1);
  return min === undefined || max === undefined ? null : { min, max };
}
