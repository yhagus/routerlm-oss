import { withAutomaticCacheBreakpoints } from "./automatic-cache-breakpoints.js";
import type { InferenceRequest } from "./internal-format.js";

const ANTHROPIC_MARKER_LIMIT = 4;

const CONVERSATION: InferenceRequest = {
  model: "smart",
  system: [
    { type: "text", text: "You are Acme's assistant." },
    { type: "text", text: "Answer in French." },
  ],
  messages: [
    { role: "user", content: [{ type: "text", text: "What time is it in Paris?" }] },
    {
      role: "assistant",
      content: [{ type: "tool-call", id: "call_1", name: "get_time", arguments: "{}" }],
    },
    { role: "tool", toolCallId: "call_1", content: [{ type: "text", text: "14:05" }] },
  ],
  tools: [
    { name: "get_weather", parameters: { type: "object" } },
    { name: "get_time", parameters: { type: "object" } },
  ],
  stream: null,
};

describe("withAutomaticCacheBreakpoints", () => {
  it("marks the end of the tools, the end of the system prompt and the latest turn", () => {
    const marked = withAutomaticCacheBreakpoints(CONVERSATION, ANTHROPIC_MARKER_LIMIT);

    expect(marked.tools).toEqual([
      { name: "get_weather", parameters: { type: "object" } },
      { name: "get_time", parameters: { type: "object" }, cacheMarker: {} },
    ]);
    expect(marked.system).toEqual([
      { type: "text", text: "You are Acme's assistant." },
      { type: "text", text: "Answer in French.", cacheMarker: {} },
    ]);
    expect(marked.messages).toEqual([
      CONVERSATION.messages[0],
      CONVERSATION.messages[1],
      {
        role: "tool",
        toolCallId: "call_1",
        content: [{ type: "text", text: "14:05", cacheMarker: {} }],
      },
    ]);
  });

  it("leaves a request alone when the client set a marker of its own", () => {
    const clientMarked: InferenceRequest = {
      ...CONVERSATION,
      system: [{ type: "text", text: "You are Acme's assistant.", cacheMarker: { ttl: "1h" } }],
    };

    expect(withAutomaticCacheBreakpoints(clientMarked, ANTHROPIC_MARKER_LIMIT)).toEqual(
      clientMarked,
    );
  });

  it("marks only the latest turn when the Provider accepts a single marker", () => {
    const marked = withAutomaticCacheBreakpoints(CONVERSATION, 1);

    expect(marked.tools).toEqual(CONVERSATION.tools);
    expect(marked.system).toEqual(CONVERSATION.system);
    expect(marked.messages.at(-1)?.content).toEqual([
      { type: "text", text: "14:05", cacheMarker: {} },
    ]);
  });

  it("marks the last part of the latest turn that is written upstream, skipping empty text", () => {
    const marked = withAutomaticCacheBreakpoints(
      {
        ...CONVERSATION,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: "https://example.com/cat.png" } },
              { type: "text", text: "" },
            ],
          },
        ],
      },
      ANTHROPIC_MARKER_LIMIT,
    );

    expect(marked.messages[0].content).toEqual([
      {
        type: "image",
        source: { type: "url", url: "https://example.com/cat.png" },
        cacheMarker: {},
      },
      { type: "text", text: "" },
    ]);
  });
});
