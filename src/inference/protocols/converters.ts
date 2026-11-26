import type { AuthStyle, ClientProtocol, UpstreamProtocol } from '@/db/schemas';
import { anthropicMessagesClientConverter } from './anthropic-messages/anthropic-messages-client-converter';
import { anthropicMessagesUpstreamConverter } from './anthropic-messages/anthropic-messages-upstream-converter';
import type { ClientProtocolConverter } from './client-protocol-converter';
import { openAiChatClientConverter } from './openai-chat/openai-chat-client-converter';
import { openAiChatUpstreamConverter } from './openai-chat/openai-chat-upstream-converter';
import { openAiResponsesClientConverter } from './openai-responses/openai-responses-client-converter';
import { openAiResponsesUpstreamConverter } from './openai-responses/openai-responses-upstream-converter';
import type { UpstreamProtocolConverter } from './upstream-protocol-converter';

export const CLIENT_PROTOCOL_CONVERTERS: Partial<Record<ClientProtocol, ClientProtocolConverter>> =
  {
    'openai-chat': openAiChatClientConverter,
    'anthropic-messages': anthropicMessagesClientConverter,
    'openai-responses': openAiResponsesClientConverter,
  };

export const UPSTREAM_PROTOCOL_CONVERTERS: Partial<
  Record<UpstreamProtocol, UpstreamProtocolConverter>
> = {
  'openai-chat': openAiChatUpstreamConverter,
  'anthropic-messages': anthropicMessagesUpstreamConverter,
  'openai-responses': openAiResponsesUpstreamConverter,
};

export function upstreamAuthHeaders(
  authStyle: AuthStyle,
  providerAccountKey: string,
): Record<string, string> {
  switch (authStyle) {
    case 'bearer':
      return { authorization: `Bearer ${providerAccountKey}` };
    case 'x-api-key':
      return { 'x-api-key': providerAccountKey };
  }
}
