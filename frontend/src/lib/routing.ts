import type { Combo, ProviderConnection, ProviderNode } from "@/types/api";
import { providerMeta, resolveProviderId } from "@/lib/providerMeta";

export type AccountFilters = Record<string, string[]>;
export const ACCOUNT_GROUP_FILTER_PREFIX = "@group:";

export function accountGroupFilterToken(group: string): string {
  return `${ACCOUNT_GROUP_FILTER_PREFIX}${group}`;
}

export function accountGroupNameFromFilter(value: string): string | null {
  const group = value.startsWith(ACCOUNT_GROUP_FILTER_PREFIX)
    ? value.slice(ACCOUNT_GROUP_FILTER_PREFIX.length).trim()
    : "";
  return group || null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function connectionData(
  connection: ProviderConnection,
): Record<string, unknown> {
  return parseJson(connection.data, {} as Record<string, unknown>);
}

export function connectionGroup(connection: ProviderConnection): string {
  const legacy = connection as ProviderConnection & { group?: string };
  const data = connectionData(connection);
  return String(legacy.group || data.group || "").trim();
}

export function connectionLabel(connection: ProviderConnection): string {
  const data = connectionData(connection);
  return String(
    connection.name || connection.email || data.displayName || connection.id,
  );
}

export function connectionSecondaryLabel(
  connection: ProviderConnection,
): string | null {
  const label = connectionLabel(connection);
  const candidates = [
    connection.email,
    String(connectionData(connection).displayName || ""),
  ];
  return (
    candidates.find((candidate) => candidate && candidate !== label) || null
  );
}

export function providerLabel(
  providerId: string,
  nodes: ProviderNode[],
): string {
  const node = nodes.find((entry) => entry.id === providerId);
  return String(
    node?.name || providerMeta(providerId).name || providerId,
  ).replaceAll("_", " ");
}

export function groupConnections(connections: ProviderConnection[]) {
  const groups = new Map<string, ProviderConnection[]>();
  for (const connection of connections) {
    const name = connectionGroup(connection) || "Ungrouped";
    groups.set(name, [...(groups.get(name) || []), connection]);
  }
  return [...groups.entries()]
    .map(([name, group]) => ({ name, connections: group }))
    .sort((a, b) => {
      if (a.name === "Ungrouped") return 1;
      if (b.name === "Ungrouped") return -1;
      return a.name.localeCompare(b.name);
    });
}

export function comboModels(combo: Combo | null | undefined): string[] {
  const parsed = parseJson<unknown>(combo?.models, []);
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
}

export function comboAccountFilters(
  combo: Combo | null | undefined,
): AccountFilters {
  const raw = combo?.accountFilters ?? combo?.account_filters;
  const parsed = parseJson<Record<string, unknown>>(raw, {});
  return Object.fromEntries(
    Object.entries(parsed).map(([model, ids]) => [
      model,
      Array.isArray(ids) ? ids.map(String) : [],
    ]),
  );
}

export function comboUsesCustomOrder(combo: Combo | null | undefined): boolean {
  const value: unknown =
    combo?.useCustomAccountOrder ?? combo?.use_custom_account_order;
  return value === true || value === 1 || value === "1";
}

function modelParts(entry: string): { prefix: string; model: string } {
  const separator = entry.indexOf("/");
  return separator < 0
    ? { prefix: entry, model: "" }
    : { prefix: entry.slice(0, separator), model: entry.slice(separator + 1) };
}

export function resolveModelProvider(
  entry: string,
  nodes: ProviderNode[],
  aliases: Record<string, string>,
  seen = new Set<string>(),
) {
  if (!seen.has(entry) && !entry.includes("/")) {
    const alias = aliases[entry];
    if (alias) {
      seen.add(entry);
      return resolveModelProvider(alias, nodes, aliases, seen);
    }
  }

  const { prefix, model } = modelParts(entry);
  const node = nodes.find((candidate) => candidate.prefix === prefix);
  const providerId = node?.id || resolveProviderId(prefix);
  return {
    providerId,
    providerLabel: node?.name || providerLabel(providerId, nodes),
    model,
  };
}

export function withConnectionGroup(
  connection: ProviderConnection,
  group: string,
): Record<string, unknown> {
  const data = connectionData(connection);
  if (group) return { ...data, group };
  return { ...data, group: null };
}
