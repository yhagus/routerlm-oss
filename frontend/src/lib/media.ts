import type { ModelItem, ProviderConnection } from "@/types/api";

export interface MediaKindConfig {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  available: boolean;
  unavailableReason?: string;
}

export interface MediaProviderSummary {
  providerId: string;
  name: string;
  noAuth?: boolean;
  display?: Record<string, unknown>;
  connections: ProviderConnection[];
  models: ModelItem[];
}

export interface MediaCatalogProvider {
  id: string;
  name: string;
  noAuth: boolean;
  display?: Record<string, unknown>;
}

// Visible kinds mirror v1's VISIBLE_MEDIA_KINDS (music/imageToText/webSearch/webFetch stay
// hidden; web search + fetch share the combined /dashboard/media-providers/web page).
export const mediaKinds: MediaKindConfig[] = [
  {
    id: "image",
    label: "Image generation",
    description:
      "Generate images through the OpenAI-compatible image endpoint.",
    endpoint: "/v1/images/generations",
    available: true,
  },
  {
    id: "embedding",
    label: "Embeddings",
    description:
      "Turn text into vectors for search, retrieval, and similarity workflows.",
    endpoint: "/v1/embeddings",
    available: true,
  },
  {
    id: "tts",
    label: "Text to speech",
    description: "Render text into playable speech or a JSON base64 payload.",
    endpoint: "/v1/audio/speech",
    available: true,
  },
  {
    id: "stt",
    label: "Speech to text",
    description: "Transcribe an uploaded audio file.",
    endpoint: "/v1/audio/transcriptions",
    available: true,
  },
  {
    id: "video",
    label: "Video generation",
    description: "Create video jobs from a prompt.",
    endpoint: "/v1/videos/generations",
    available: true,
  },
];

export function mediaKindConfig(kind: string): MediaKindConfig | undefined {
  return mediaKinds.find((item) => item.id === kind);
}

export function providerIdForModel(model: ModelItem): string {
  return (
    model.owned_by || model.provider || model.id.split("/")[0] || "unknown"
  );
}

export function buildMediaProviderSummaries(
  models: ModelItem[],
  providers: ProviderConnection[],
  catalog: MediaCatalogProvider[] = [],
  includeConnectionOnly = true,
): MediaProviderSummary[] {
  const groups = new Map<string, MediaProviderSummary>();
  const ensure = (
    providerId: string,
    name = providerId,
    noAuth = false,
    display?: Record<string, unknown>,
  ) => {
    if (!groups.has(providerId))
      groups.set(providerId, {
        providerId,
        name,
        noAuth,
        display,
        connections: [],
        models: [],
      });
    return groups.get(providerId)!;
  };

  for (const provider of catalog)
    ensure(provider.id, provider.name, provider.noAuth, provider.display);

  for (const provider of providers) {
    if (!includeConnectionOnly && !groups.has(provider.provider)) continue;
    const group = ensure(provider.provider, provider.name || provider.provider);
    group.connections.push(provider);
    if (!group.name || group.name === group.providerId)
      group.name = provider.name || provider.provider;
  }
  for (const model of models) {
    const providerId = providerIdForModel(model);
    if (!includeConnectionOnly && !groups.has(providerId)) continue;
    const group = ensure(providerId, model.owned_by || providerId);
    if (!group.models.some((entry) => entry.id === model.id))
      group.models.push(model);
  }

  return [...groups.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function modelForProvider(
  model: ModelItem,
  providerId: string,
): boolean {
  return (
    providerIdForModel(model) === providerId ||
    model.id.startsWith(`${providerId}/`)
  );
}
