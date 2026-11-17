/** A model as models.dev lists it under a provider. */
export interface ModelsDevModel {
  id: string;
  name: string;
  /** As models.dev writes it: `YYYY-MM-DD`, or `YYYY-MM` when the day is unknown. */
  releaseDate: string;
}

/** The newest models of each models.dev provider, read at `checkedAt`. */
export interface ModelsDevSnapshot {
  checkedAt: Date;
  newestModelsByProviderId: Map<string, ModelsDevModel[]>;
}
