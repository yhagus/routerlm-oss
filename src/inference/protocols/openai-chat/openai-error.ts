import type { GatewayError } from "@/inference/models/gateway-error.js";
import { openAiChatClientConverter } from "./openai-chat-client-converter.js";

export function writeOpenAiError(error: GatewayError): unknown {
  return openAiChatClientConverter.writeError(error);
}
