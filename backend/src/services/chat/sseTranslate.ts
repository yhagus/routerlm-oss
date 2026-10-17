export function translateSse(body: ReadableStream<Uint8Array>, target: "openai" | "claude"): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let responseId = `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`;
  let index = 0;

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (!normalized.startsWith("data:")) continue;
        const raw = normalized.slice(5).trim();
        if (!raw) continue;
        if (raw === "[DONE]") {
          if (target === "claude") controller.enqueue(encoder.encode("event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n"));
          else controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          continue;
        }
        try {
          const event = JSON.parse(raw) as Record<string, unknown>;
          if (target === "claude") {
            const choices = Array.isArray(event.choices) ? event.choices : [];
            const choice = (choices[0] || {}) as Record<string, unknown>;
            const delta = (choice.delta || {}) as Record<string, unknown>;
            if (typeof delta.content === "string") controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta.content } })}\n\n`));
          } else {
            const type = String(event.type || "");
            const delta = (event.delta || {}) as Record<string, unknown>;
            const text = typeof delta.text === "string" ? delta.text : type === "content_block_delta" && typeof delta.text === "string" ? delta.text : "";
            if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", choices: [{ index, delta: { content: text }, finish_reason: null }] })}\n\n`));
          }
          index += 1;
        } catch {
           controller.enqueue(encoder.encode(`${normalized}\n\n`));
        }
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (!buffer.trim()) return;
      const normalized = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      if (normalized.startsWith("data:")) {
        const raw = normalized.slice(5).trim();
        if (raw === "[DONE]") controller.enqueue(encoder.encode(target === "claude" ? "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n" : "data: [DONE]\n\n"));
        else {
          try {
            const event = JSON.parse(raw) as Record<string, unknown>;
            if (target === "openai") {
              const delta = (event.delta || {}) as Record<string, unknown>;
              if (typeof delta.text === "string") controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", choices: [{ index, delta: { content: delta.text }, finish_reason: null }] })}\n\n`));
            }
          } catch { controller.enqueue(encoder.encode(`${normalized}\n\n`)); }
        }
      } else controller.enqueue(encoder.encode(`${normalized}\n\n`));
    },
  }));
}
