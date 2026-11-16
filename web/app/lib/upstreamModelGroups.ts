import { CAPABILITIES, type Capability, type UpstreamModel } from "~/lib/upstream";

/**
 * Upstream Models that share one exact `upstreamModelId` under different
 * Providers, listed as one row with a row per Provider below it.
 */
export interface UpstreamModelGroup {
  upstreamModelId: string;
  /** Two or more, in the list's sort order; the first is the one the group sorts by. */
  members: [UpstreamModel, ...UpstreamModel[]];
}

/** A top-level row of the Upstream Models list. */
export type UpstreamModelRow = UpstreamModel | UpstreamModelGroup;

export function isUpstreamModelGroup(row: UpstreamModelRow): row is UpstreamModelGroup {
  return "members" in row;
}

/**
 * Lists `models` with the ones that share an id as one group each, ordered by
 * `compare`. Members are ordered by it too, and a group sorts by its first
 * member, so it ranks where its best member would: the cheapest under a
 * lowest-price order, the newest under "newest".
 */
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

/** The first display name a member has; null when none has one. */
export function groupName(group: UpstreamModelGroup): string | null {
  return group.members.find((model) => model.name !== null)?.name ?? null;
}

/** Every Capability at least one member has, in the usual order. */
export function groupCapabilities(group: UpstreamModelGroup): Capability[] {
  return CAPABILITIES.filter((capability) =>
    group.members.some((model) => model.capabilities.includes(capability)),
  );
}

/** The smallest and largest of the values that are set; null when none is. */
export function rangeOf<Value>(
  values: (Value | null)[],
  compare: (first: Value, second: Value) => number,
): { min: Value; max: Value } | null {
  const sorted = values.filter((value): value is Value => value !== null).toSorted(compare);
  const min = sorted[0];
  const max = sorted.at(-1);
  return min === undefined || max === undefined ? null : { min, max };
}
