import type { AuthStyle, ClientProtocol, UpstreamProtocol } from "@/db/schemas/index.js";
import { anthropicMessagesClientConverter } from "./anthropic-messages/anthropic-messages-client-converter.js";
import { anthropicMessagesUpstreamConverter } from "./anthropic-messages/anthropic-messages-upstream-converter.js";
import type { ClientProtocolConverter } from "./client-protocol-converter.js";
import { openAiChatClientConverter } from "./openai-chat/openai-chat-client-converter.js";
import { openAiChatUpstreamConverter } from "./openai-chat/openai-chat-upstream-converter.js";
import { openAiResponsesClientConverter } from "./openai-responses/openai-responses-client-converter.js";
import { openAiResponsesUpstreamConverter } from "./openai-responses/openai-responses-upstream-converter.js";
import type { UpstreamProtocolConverter } from "./upstream-protocol-converter.js";

// Adding a Protocol means writing its converter and adding it here (ADR 0002).

export const CLIENT_PROTOCOL_CONVERTERS: Partial<Record<ClientProtocol, ClientProtocolConverter>> =
  {
    "openai-chat": openAiChatClientConverter,
    "anthropic-messages": anthropicMessagesClientConverter,
    "openai-responses": openAiResponsesClientConverter,
  };

/** A Route whose Provider speaks a Protocol missing here can't be served and is skipped. */
export const UPSTREAM_PROTOCOL_CONVERTERS: Partial<
  Record<UpstreamProtocol, UpstreamProtocolConverter>
> = {
  "openai-chat": openAiChatUpstreamConverter,
  "anthropic-messages": anthropicMessagesUpstreamConverter,
  "openai-responses": openAiResponsesUpstreamConverter,
};

/** The header carrying a Provider Account key, in the Provider's auth style. */
export function upstreamAuthHeaders(
  authStyle: AuthStyle,
  providerAccountKey: string,
): Record<string, string> {
  switch (authStyle) {
    case "bearer":
      return { authorization: `Bearer ${providerAccountKey}` };
    case "x-api-key":
      return { "x-api-key": providerAccountKey };
  }
}
