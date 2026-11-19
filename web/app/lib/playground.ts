// The Playground's conversation, held in the browser only, and the Chat
// Completions stream the backend answers it with.

import type { ReasoningEffort } from "~/lib/parameterPolicy";

/** What a media Kind counted, such as images made; each Kind sets only its own. */
export interface PlaygroundUnits {
  imagesOut?: number;
  imagesIn?: number;
  /** Characters of text a speech request spoke. */
  characters?: number;
  /** The price tier the Provider names, such as `2K`. */
  tier?: string;
}

/** What the backend sends after the answer: tokens or units, Cost, and who served it. */
export interface PlaygroundSummary {
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    reasoningTokens: number | null;
  };
  /** Null for chat, which counts tokens instead. */
  units: PlaygroundUnits | null;
  cost: number | null;
  /** The served Route; null for a direct Upstream Model test or when nothing answered. */
  route: { id: string; providerSlug: string; upstreamModelId: string } | null;
  /** The Upstream Model that answered, for both sources; null when nothing answered. */
  upstreamModel: { id: string; upstreamModelId: string; providerSlug: string } | null;
  providerAccount: { id: string; name: string } | null;
}

/**
 * Our error contract: a code from the error table and our own message. The
 * code is null when the request never reached the inference path.
 */
export interface PlaygroundError {
  code: string | null;
  message: string;
}

export type AnswerState =
  | { kind: "streaming" }
  | { kind: "done"; summary: PlaygroundSummary | null }
  | { kind: "failed"; error: PlaygroundError; summary: PlaygroundSummary | null }
  | { kind: "stopped" };

export interface UserMessage {
  role: "user";
  text: string;
  /** Data URLs: images go inline and are never uploaded anywhere. */
  imageUrls: string[];
}

export interface AssistantMessage {
  role: "assistant";
  text: string;
  reasoning: string;
  state: AnswerState;
}

export type PlaygroundMessage = UserMessage | AssistantMessage;

/** Parameters left undefined are not sent, so the Model's Parameter Policy decides. */
export interface PlaygroundSettings {
  model: string;
  systemPrompt: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

/** The Chat Completions body for the whole conversation so far. */
export function chatCompletionRequest(
  settings: PlaygroundSettings,
  conversation: PlaygroundMessage[],
): Record<string, unknown> {
  const messages: unknown[] = [];
  if (settings.systemPrompt.trim() !== "") {
    messages.push({ role: "system", content: settings.systemPrompt });
  }
  for (const message of conversation) {
    if (message.role === "user") {
      messages.push({ role: "user", content: userContentOf(message) });
    } else if (message.state.kind === "done" && message.text !== "") {
      messages.push({ role: "assistant", content: message.text });
    }
  }
  return {
    model: settings.model,
    messages,
    stream: true,
    temperature: settings.temperature,
    top_p: settings.topP,
    max_tokens: settings.maxOutputTokens,
    reasoning_effort: settings.reasoningEffort,
  };
}

function userContentOf(message: UserMessage): unknown {
  if (message.imageUrls.length === 0) {
    return message.text;
  }
  return [
    ...(message.text === "" ? [] : [{ type: "text", text: message.text }]),
    ...message.imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
}

export type StreamEvent =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "error"; error: PlaygroundError }
  | { kind: "summary"; summary: PlaygroundSummary };

const EVENT_SEPARATOR = "\n\n";
const SUMMARY_EVENT = "summary";
const DONE_DATA = "[DONE]";

/** Reads the backend's event stream as it arrives. */
export async function* streamEventsOf(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<StreamEvent> {
  // A TextDecoder rather than a TextDecoderStream: the stream's types only
  // accept ArrayBuffer-backed chunks, and fetch bodies are typed more widely.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffered += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    let end = buffered.indexOf(EVENT_SEPARATOR);
    while (end !== -1) {
      const event = streamEventOf(buffered.slice(0, end));
      if (event) yield event;
      buffered = buffered.slice(end + EVENT_SEPARATOR.length);
      end = buffered.indexOf(EVENT_SEPARATOR);
    }
  }
}

function streamEventOf(block: string): StreamEvent | null {
  let name = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice("event:".length).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  const data = dataLines.join("\n");
  if (data === "" || data === DONE_DATA) return null;
  const payload: unknown = JSON.parse(data);
  if (name === SUMMARY_EVENT) {
    return isPlaygroundSummary(payload) ? { kind: "summary", summary: payload } : null;
  }
  const error = playgroundErrorOf(payload);
  if (error) return { kind: "error", error };
  const delta = readProperty(readProperty(readProperty(payload, "choices"), 0), "delta");
  const reasoning = readProperty(delta, "reasoning_content");
  if (typeof reasoning === "string" && reasoning !== "")
    return { kind: "reasoning", text: reasoning };
  const content = readProperty(delta, "content");
  if (typeof content === "string" && content !== "") return { kind: "text", text: content };
  return null;
}

export function isPlaygroundSummary(payload: unknown): payload is PlaygroundSummary {
  const usage = readProperty(payload, "usage");
  const cost = readProperty(payload, "cost");
  return typeof usage === "object" && usage !== null && (cost === null || typeof cost === "number");
}

/** The error envelope `{ error: { code, message } }`, if `payload` is one. */
export function playgroundErrorOf(payload: unknown): PlaygroundError | null {
  const error = readProperty(payload, "error");
  const code = readProperty(error, "code");
  const message = readProperty(error, "message");
  return typeof code === "string" && typeof message === "string" ? { code, message } : null;
}

/**
 * The error of a failed Playground call. The body was asked for as a stream,
 * so a refused request's JSON envelope arrives as one too.
 */
export async function playgroundErrorOfFailure(failure: unknown): Promise<PlaygroundError | null> {
  const data = readProperty(failure, "data");
  if (!(data instanceof ReadableStream)) return playgroundErrorOf(data);
  try {
    return playgroundErrorOf(JSON.parse(await new Response(data).text()));
  } catch {
    return null;
  }
}

/** Images go inline as data URLs; this keeps a request well under the body limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function dataUrlOf(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The image could not be read"));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

export function readProperty(value: unknown, key: string | number): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}
