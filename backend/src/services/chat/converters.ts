// Client-format converters shared by the generic gateway path and the
// specialized-executor path. Bodies pivot through OpenAI chat shape.

const json = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});

function messagesFromInput(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) return input.map((item) => typeof item === "string" ? { role: "user", content: item } : json(item));
  if (typeof input === "string") return [{ role: "user", content: input }];
  return [];
}

export function toOpenAi(body: Record<string, unknown>, source: "openai" | "claude" | "responses" | "ollama"): Record<string, unknown> {
  if (source === "openai" || source === "ollama") return { ...body };
  if (source === "responses") return { ...body, messages: messagesFromInput(body.input), stream: body.stream ?? false };
  const messages: Record<string, unknown>[] = [];
  if (body.system) messages.push({ role: "system", content: typeof body.system === "string" ? body.system : JSON.stringify(body.system) });
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const value = json(message);
    const content = Array.isArray(value.content)
      ? value.content.map((part) => { const item = json(part); return item.type === "text" ? item.text : item; })
      : value.content;
    messages.push({ ...value, content });
  }
  return { ...body, messages, max_tokens: body.max_tokens ?? body.max_tokens_to_sample, stream: body.stream ?? false };
}

export function toAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages.map((message) => {
    const item = json(message);
    return { role: item.role === "assistant" ? "assistant" : "user", content: item.content ?? "" };
  }).filter((message) => message.content !== "") : [];
  const system = Array.isArray(body.messages) ? body.messages.map(json).filter((message) => message.role === "system").map((message) => message.content).join("\n") : undefined;
  return {
    model: body.model,
    max_tokens: Number(body.max_tokens || body.max_completion_tokens || 4096),
    messages,
    ...(system ? { system } : {}),
    ...(body.stream != null ? { stream: body.stream } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.tools ? { tools: body.tools } : {}),
  };
}

export function toClaude(response: Record<string, unknown>): Record<string, unknown> {
  const choice = json(Array.isArray(response.choices) ? response.choices[0] : {});
  const message = json(choice.message);
  const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content || []);
  const usage = json(response.usage);
  return {
    id: String(response.id || `msg_${crypto.randomUUID().replaceAll("-", "")}`),
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: choice.finish_reason === "stop" ? "end_turn" : choice.finish_reason || null,
    stop_sequence: null,
    usage: { input_tokens: Number(usage.prompt_tokens || 0), output_tokens: Number(usage.completion_tokens || 0) },
  };
}

export function toResponses(response: Record<string, unknown>): Record<string, unknown> {
  const choice = json(Array.isArray(response.choices) ? response.choices[0] : {});
  const message = json(choice.message);
  const text = typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.map((item) => typeof item === "string" ? item : json(item).text || "").join("") : "";
  const usage = json(response.usage);
  return { id: String(response.id || `resp_${crypto.randomUUID().replaceAll("-", "")}`), object: "response", model: response.model, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], output_text: text, usage: { input_tokens: Number(usage.prompt_tokens || 0), output_tokens: Number(usage.completion_tokens || 0), total_tokens: Number(usage.total_tokens || 0) } };
}

export function fromAnthropic(response: Record<string, unknown>): Record<string, unknown> {
  const content = Array.isArray(response.content) ? response.content : [];
  const text = content.map((part) => { const item = json(part); return typeof item.text === "string" ? item.text : ""; }).join("");
  const usage = json(response.usage);
  return {
    id: response.id || `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    model: response.model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: response.stop_reason || "stop" }],
    usage: { prompt_tokens: Number(usage.input_tokens || 0), completion_tokens: Number(usage.output_tokens || 0), total_tokens: Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0) },
  };
}

// Responses-shaped JSON ({"output": [...], "output_text"}) → OpenAI completion.
export function fromResponsesShape(response: Record<string, unknown>): Record<string, unknown> {
  const output = Array.isArray(response.output) ? response.output : [];
  const messageOutput = json(output.find((part) => json(part).type === "message"));
  const contentParts = Array.isArray(messageOutput.content) ? messageOutput.content : [];
  const text = contentParts.map((part) => String(json(part).text || "")).join("") || String(response.output_text || "");
  const usage = json(response.usage);
  return {
    id: response.id || `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    model: response.model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: Number(usage.input_tokens || 0), completion_tokens: Number(usage.output_tokens || 0), total_tokens: Number(usage.total_tokens || Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)) },
  };
}

// Gemini full JSON response ({"candidates": [...], "usageMetadata"}) → OpenAI completion.
export function fromGeminiShape(response: Record<string, unknown>): Record<string, unknown> {
  const inner = json(response.response || response);
  const candidates = Array.isArray(inner.candidates) ? inner.candidates : [];
  const candidate = json(candidates[0]);
  const parts = (Array.isArray(json(candidate.content).parts) ? json(candidate.content).parts : []) as Array<Record<string, unknown>>;
  const text = parts.map((part) => String(json(part).text || "")).join("");
  const usage = json(inner.usageMetadata);
  const finish = String(candidate.finishReason || "STOP").toLowerCase();
  return {
    id: inner.responseId || response.id || `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    model: inner.modelVersion || response.model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finish === "stop" ? "stop" : finish === "max_tokens" ? "length" : "stop" }],
    usage: {
      prompt_tokens: Number(usage.promptTokenCount || 0),
      completion_tokens: Number(usage.candidatesTokenCount || 0),
      total_tokens: Number(usage.totalTokenCount || Number(usage.promptTokenCount || 0) + Number(usage.candidatesTokenCount || 0)),
      ...(usage.thoughtsTokenCount ? { completion_tokens_details: { reasoning_tokens: Number(usage.thoughtsTokenCount) } } : {}),
    },
  };
}

export interface CompletionAccumulator {
  add(chunk: Record<string, unknown>): void;
  result(): Record<string, unknown>;
}

// Merge OpenAI stream chunks into one completion object, one chunk at a time.
// `maxTextLength` caps content, reasoning, and each tool-call argument string,
// and `maxToolCalls` caps the tool-call count. A stream summary uses the caps
// so a long response does not keep its full text in memory.
export function createCompletionAccumulator(limits: { maxTextLength?: number; maxToolCalls?: number } = {}): CompletionAccumulator {
  const maxText = limits.maxTextLength ?? Infinity;
  const maxToolCalls = limits.maxToolCalls ?? Infinity;
  const append = (current: string, next: string) => (current.length >= maxText ? current : (current + next).slice(0, maxText));
  let id: unknown = undefined;
  let model: unknown = undefined;
  let content = "";
  let reasoning = "";
  const toolCalls: Array<Record<string, unknown>> = [];
  let finishReason: unknown = null;
  let usage: Record<string, unknown> | null = null;
  return {
    add(chunk) {
      if (!id && chunk.id) id = chunk.id;
      if (!model && chunk.model) model = chunk.model;
      const choice = json(Array.isArray(chunk.choices) ? chunk.choices[0] : {});
      const delta = json(choice.delta);
      if (typeof delta.content === "string") content = append(content, delta.content);
      if (typeof delta.reasoning_content === "string") reasoning = append(reasoning, delta.reasoning_content);
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          const item = json(call);
          const index = Number(item.index || 0);
          const existing = toolCalls.find((entry) => entry.index === index);
          const function_ = json(item.function);
          if (existing) {
            const target = existing.function as Record<string, unknown>;
            if (typeof function_.name === "string") target.name = append(String(target.name || ""), function_.name);
            if (typeof function_.arguments === "string") target.arguments = append(String(target.arguments || ""), function_.arguments);
          } else if (toolCalls.length < maxToolCalls) {
            toolCalls.push({ id: item.id || `call_${index}`, type: "function", index, function: { name: function_.name || "", arguments: typeof function_.arguments === "string" ? function_.arguments.slice(0, maxText) : function_.arguments || "" } });
          }
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage && typeof chunk.usage === "object") usage = json(chunk.usage);
    },
    result() {
      const message: Record<string, unknown> = { role: "assistant", content };
      if (reasoning) message.reasoning_content = reasoning;
      if (toolCalls.length) {
        message.content = content || null;
        message.tool_calls = toolCalls.map(({ id: callId, type, function: function_ }) => ({ id: callId, type, function: function_ }));
      }
      return {
        id: String(id || `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`),
        object: "chat.completion",
        model,
        choices: [{ index: 0, message, finish_reason: finishReason || "stop" }],
        ...(usage ? { usage } : {}),
      };
    },
  };
}

// Merge a sequence of OpenAI stream chunks into one completion object.
export function mergeChunksToCompletion(chunks: Record<string, unknown>[]): Record<string, unknown> {
  const accumulator = createCompletionAccumulator();
  for (const chunk of chunks) accumulator.add(chunk);
  return accumulator.result();
}
