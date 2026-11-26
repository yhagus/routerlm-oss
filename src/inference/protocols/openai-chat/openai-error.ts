import type { GatewayError } from '@/inference/models/gateway-error';
import { openAiChatClientConverter } from './openai-chat-client-converter';

export function writeOpenAiError(error: GatewayError): unknown {
  return openAiChatClientConverter.writeError(error);
}
