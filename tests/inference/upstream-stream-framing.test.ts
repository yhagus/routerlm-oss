import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import {
  anthropicMessagesFixture,
  FakeUpstream,
  openAiChatFixture,
} from "@tests/support/fake-upstream.js";
import {
  insertAnthropicMessagesModel,
  insertApiKey,
  insertOpenAiChatModel,
} from "@tests/support/inference.js";
import { createTestApp } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const CHAT_MODEL = "via-chat";
const MESSAGES_MODEL = "via-messages";

const PIECE_LENGTH = 300;

function chatChunkData(delta: object, finishReason: string | null = null): string {
  return JSON.stringify({
    id: "chatcmpl-upstream-1",
    object: "chat.completion.chunk",
    created: 1_794_700_000,
    model: "acme-large-2026",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

function piecesOf(text: string): string[] {
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += PIECE_LENGTH) {
    pieces.push(text.slice(start, start + PIECE_LENGTH));
  }
  return pieces;
}

function streamedContentOf(text: string): string {
  return text
    .trim()
    .split("\n\n")
    .filter((event) => event !== "data: [DONE]")
    .map((event) => JSON.parse(event.slice("data: ".length)))
    .map((chunk) => chunk.choices[0]?.delta.content ?? "")
    .join("");
}

describe("Reading an upstream's server-sent events (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    await insertOpenAiChatModel(app, db, { modelName: CHAT_MODEL, baseUrl: upstream.baseUrl });
    await insertAnthropicMessagesModel(app, db, {
      modelName: MESSAGES_MODEL,
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function streamChat(model: string) {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model, messages: [{ role: "user", content: "Hi" }], stream: true })
      .expect(200);
  }

  it.each([
    [CHAT_MODEL, openAiChatFixture("upstream-stream-tool-call.sse")],
    [MESSAGES_MODEL, anthropicMessagesFixture("upstream-stream-tool-call.sse")],
  ])("reassembles the events of %s's stream split across packets", async (model, recorded) => {
    upstream.reply({ kind: "stream-in-pieces", pieces: piecesOf(recorded) });

    const response = await streamChat(model);

    expect(streamedContentOf(response.text)).toBe("Checking.");
    expect(response.text.trim().split("\n\n").at(-1)).toBe("data: [DONE]");
  });

  it("accepts CRLF line endings, joins multi-line data and skips comments", async () => {
    const [firstHalf, secondHalf] = chatChunkData({ content: "Hello" }).split('"delta"');
    upstream.reply({
      kind: "stream",
      events: [
        ": keep-alive\r\n\r\n",
        `data: ${firstHalf}\r\ndata: "delta"${secondHalf}\r\n\r\n`,
        `data: ${chatChunkData({}, "stop")}\r\n\r\n`,
        "data: [DONE]\r\n\r\n",
      ].join(""),
    });

    const response = await streamChat(CHAT_MODEL);

    expect(streamedContentOf(response.text)).toBe("Hello");
  });

  it("decodes a multi-byte character split between packets", async () => {
    const bytes = new TextEncoder().encode(
      [
        `data: ${chatChunkData({ content: "é" })}\n\n`,
        `data: ${chatChunkData({}, "stop")}\n\n`,
        "data: [DONE]\n\n",
      ].join(""),
    );
    const [firstByteOfE] = new TextEncoder().encode("é");
    const splitAt = bytes.indexOf(firstByteOfE) + 1;
    upstream.reply({
      kind: "stream-in-pieces",
      pieces: [bytes.slice(0, splitAt), bytes.slice(splitAt)],
    });

    const response = await streamChat(CHAT_MODEL);

    expect(streamedContentOf(response.text)).toBe("é");
  });
});
