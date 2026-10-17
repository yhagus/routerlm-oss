// OpenAI-compatible adapter (used by openai, recraft)
import { PROVIDER_MEDIA } from "../../providers/index.ts";

const imageCfg = (id: any) => PROVIDER_MEDIA[id]?.imageConfig || {};
const imageUrl = (id: any) => imageCfg(id).baseUrl;

export default function createOpenAIAdapter(providerId: any) {
  const cfg = imageCfg(providerId);
  return {
    buildUrl: () => imageUrl(providerId),
    buildHeaders: (creds: any) => {
      const headers: Record<string, any> = { "Content-Type": "application/json", ...(cfg.headers || {}) };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return headers;
    },
    buildBody: (model: any, body: any) => {
      const { prompt, n = 1, size = "1024x1024", quality, style, response_format } = body;
      const full: Record<string, any> = { model, prompt, n, size };
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;
      // bodyFields whitelist (e.g. xAI accepts only model/prompt/n/response_format)
      if (Array.isArray(cfg.bodyFields)) {
        const req: Record<string, any> = {};
        for (const f of cfg.bodyFields) if (full[f] !== undefined) req[f] = full[f];
        return req;
      }
      return full;
    },
    normalize: (responseBody: any) => responseBody,
  };
}
