import type { Runtime } from "../../runtime";
import type { ApiKeyRecord } from "../../db/repositories";
import { handleSttCore } from "./sttCore.ts";
import { getProviderRegistryEntry } from "../providers/providerCatalog";
import { enforceApiKeyAccess, errorResponse, mediaFallbackLoop, mediaModelInfo, mediaUsage } from "./shared";

interface SttInput {
  formData: FormData;
  apiKey: ApiKeyRecord | null;
  clientIp?: string;
}

// POST /v1/audio/transcriptions — multipart form (file + model) forwarded
// through the provider's sttConfig protocol.
export async function handleMediaStt(runtime: Runtime, input: SttInput): Promise<Response> {
  const modelStr = input.formData.get("model");
  if (!modelStr) return errorResponse(400, "Missing model");
  if (!input.formData.get("file")) return errorResponse(400, "Missing required field: file");

  const model = String(modelStr);
  const info = mediaModelInfo(runtime, model);
  if (!info.provider) return errorResponse(400, "Invalid model format");

  const blocked = enforceApiKeyAccess(input.apiKey, model);
  if (blocked) return blocked;

  const entry = getProviderRegistryEntry(info.provider) as Record<string, any> | null;
  const sttConfig = entry?.sttConfig || null;
  const credentialed = Boolean(entry?.serviceKinds?.includes?.("stt")) && !entry?.noAuth && sttConfig?.authType !== "none";

  if (!credentialed) {
    const result = await handleSttCore({ provider: info.provider, model: info.model, formData: input.formData, sttConfig });
    if (result.success) {
      mediaUsage(runtime, { provider: info.provider, model: info.model, endpoint: "/v1/audio/transcriptions", apiKey: input.apiKey, clientIp: input.clientIp });
      return result.response;
    }
    return errorResponse((result as any).status || 502, (result as any).error || "STT failed");
  }

  return mediaFallbackLoop(runtime, info.provider, info.model, async (connection, credentials) => {
    const result = await handleSttCore({ provider: info.provider!, model: info.model, formData: input.formData, credentials, sttConfig });
    if (result.success) {
      mediaUsage(runtime, { provider: info.provider!, model: info.model, connectionId: connection.id, endpoint: "/v1/audio/transcriptions", apiKey: input.apiKey, clientIp: input.clientIp });
    }
    return result as { success: boolean; response: Response; status?: number; error?: string };
  });
}
