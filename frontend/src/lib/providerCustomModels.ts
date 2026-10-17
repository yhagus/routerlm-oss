// Port of v1 src/shared/utils/providerCustomModels.js — the merged view of
// user-added custom models and legacy per-provider aliases.

export interface CustomModelRow {
  id: string;
  name?: string;
  fullModel: string;
  alias?: string;
  source: "custom" | "legacyAlias";
  type: string;
}

interface CustomModelEntry {
  id?: string;
  name?: string;
  providerAlias?: string;
  kind?: string;
  type?: string;
}

function modelType(model: CustomModelEntry): string {
  return model?.kind || model?.type || "llm";
}

export function getProviderCustomModelRows(input: {
  customModels: CustomModelEntry[];
  modelAliases: Record<string, string>;
  providerAlias: string;
  builtInModels?: Array<{ id: string }>;
  type?: string;
  includeLegacyAliases?: boolean;
}): CustomModelRow[] {
  const builtInIds = new Set(
    (input.builtInModels || []).map((model) => model.id),
  );
  const seenFullModels = new Set<string>();
  const rows: CustomModelRow[] = [];

  for (const model of input.customModels || []) {
    if (!model?.id || model.providerAlias !== input.providerAlias) continue;
    const rowType = modelType(model);
    if (input.type && rowType !== input.type) continue;
    if (builtInIds.has(model.id)) continue;

    const fullModel = `${input.providerAlias}/${model.id}`;
    if (seenFullModels.has(fullModel)) continue;
    seenFullModels.add(fullModel);
    rows.push({
      id: model.id,
      name: model.name || model.id,
      fullModel,
      source: "custom",
      type: rowType,
    });
  }

  if (input.includeLegacyAliases === false) return rows;

  const prefix = `${input.providerAlias}/`;
  for (const [alias, fullModel] of Object.entries(input.modelAliases || {})) {
    if (typeof fullModel !== "string" || !fullModel.startsWith(prefix))
      continue;
    const id = fullModel.slice(prefix.length);
    if (!id || builtInIds.has(id) || seenFullModels.has(fullModel)) continue;

    seenFullModels.add(fullModel);
    rows.push({
      id,
      name: id,
      alias,
      fullModel,
      source: "legacyAlias",
      type: input.type || "llm",
    });
  }

  return rows;
}
