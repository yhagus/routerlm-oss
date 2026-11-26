export interface ModelGroup {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  modelCount: number;
}

export type ModelGroupRef = Pick<ModelGroup, 'id' | 'name' | 'slug'>;

export const GROUP_SLUG_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*';
export const GROUP_SLUG_HINT = 'Lowercase letters and digits, with single hyphens between words.';

const PUBLISHED_NAME_SEPARATOR = '/';

export function publishedModelNames(model: { name: string; groups: ModelGroupRef[] }): string[] {
  if (model.groups.length === 0) return [model.name];
  return model.groups.map((group) => publishedModelName(group, model.name));
}

export function publishedModelName(group: ModelGroupRef, modelName: string): string {
  return `${group.slug}${PUBLISHED_NAME_SEPARATOR}${modelName}`;
}

export function modelNameProblem(name: string): string | null {
  return name.includes(PUBLISHED_NAME_SEPARATOR)
    ? 'A Model name cannot contain "/". Clients send "<group>/<name>", so the Group adds it.'
    : null;
}

export function isPublishedAs(
  model: { name: string; groups: ModelGroupRef[] },
  sentName: string,
): boolean {
  return publishedModelNames(model).includes(sentName);
}
