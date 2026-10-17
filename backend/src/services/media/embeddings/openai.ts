// OpenAI-compatible embeddings adapter (most providers)
import { bearerAuth } from "./_base.ts";
import { PROVIDER_MEDIA } from "../../providers/index.ts";

// media-only providers without a registry file keep URL here; rest derive from registry media.embeddingConfig.baseUrl
const ENDPOINTS: Record<string, string> = {
  "jina-ai": "https://api.jina.ai/v1/embeddings",
};

const embedCfg = (id: any) => PROVIDER_MEDIA[id]?.embeddingConfig || {};
const embedUrl = (id: any) => embedCfg(id).baseUrl || ENDPOINTS[id];

export default function createOpenAIEmbeddingAdapter(providerId: any) {
  const cfg = embedCfg(providerId);
  return {
    buildUrl: () => embedUrl(providerId),
    buildHeaders: (creds: any) => {
      return { "Content-Type": "application/json", ...bearerAuth(creds), ...(cfg.headers || {}) };
    },
    buildBody: (model: any, { input, encoding_format, dimensions }: any) => {
      const body: Record<string, any> = { model, input };
      if (encoding_format) body.encoding_format = encoding_format;
      if (dimensions != null && dimensions !== "") {
        const dim = Number(dimensions);
        if (Number.isFinite(dim) && dim > 0) body.dimensions = dim;
      }
      return body;
    },
    normalize: (responseBody: any) => responseBody,
  };
}
