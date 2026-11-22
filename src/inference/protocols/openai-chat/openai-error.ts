import type { GatewayError } from "@/inference/models/gateway-error.js";
import { openAiChatClientConverter } from "./openai-chat-client-converter.js";

/**
 * The error body of every OpenAI-shaped media endpoint: the same envelope as
 * Chat Completions, as all of them are OpenAI's.
 */
export function writeOpenAiError(error: GatewayError): unknown {
  return openAiChatClientConverter.writeError(error);
}
