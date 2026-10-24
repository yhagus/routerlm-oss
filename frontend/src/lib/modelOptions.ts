type ModelOptionSource = {
  id?: unknown;
  fullModel?: unknown;
  routedModel?: unknown;
  provider?: unknown;
  model?: unknown;
};

export function modelOptionId(model: ModelOptionSource): string {
  for (const value of [model.id, model.routedModel, model.fullModel]) {
    if (typeof value === "string" && value.trim()) return value;
  }

  if (
    typeof model.provider === "string" &&
    model.provider.trim() &&
    typeof model.model === "string" &&
    model.model.trim()
  ) {
    return `${model.provider}/${model.model}`;
  }

  return "";
}

export function modelOptionIds(models: ModelOptionSource[]): string[] {
  return [...new Set(models.map(modelOptionId).filter(Boolean))].sort();
}

// Free model variants are published as "<model>-free" or "<model>:free".
export function isFreeModelId(id: unknown): boolean {
  return typeof id === "string" && /[-:]free$/i.test(id.trim());
}
