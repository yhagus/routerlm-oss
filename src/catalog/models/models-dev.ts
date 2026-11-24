export interface ModelsDevModel {
  id: string;
  name: string;
  releaseDate: string;
}

export interface ModelsDevSnapshot {
  checkedAt: Date;
  newestModelsByProviderId: Map<string, ModelsDevModel[]>;
}
