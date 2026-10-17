import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { CLAUDE_BLOCK, ROLE } from "../schema/index.js";

function usageFromResponse(usage: any) {
  if (!usage || typeof usage !== "object") return { input_tokens: 0, output_tokens: 0 };
  return {
    input_tokens: usage.input_tokens || usage.prompt_tokens || 0,
    output_tokens: usage.output_tokens || usage.completion_tokens || 0,
  };
}

function ensureMessageStart(state: any, data: any, results: any) {
  if (state.claudeMessageStarted) return;
  const response = data?.response || {};
  state.claudeMessageStarted = true;
  state.claudeMessageId = response.id || `msg_${Date.now()}`;
  state.model = response.model || state.model || "grok-build";
  results.push({
    type: "message_start",
    message: {
      id: state.claudeMessageId,
      type: "message",
      role: ROLE.ASSISTANT,
      model: state.model,
      content: [] as any[],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
}

function stopBlock(state: any, key: any, results: any) {
  const block = state.claudeBlocks?.[key];
  if (!block || block.closed) return;
  block.closed = true;
  results.push({ type: "content_block_stop", index: block.index });
}

function startBlock(state: any, key: any, contentBlock: any, results: any) {
  state.claudeBlocks ||= {};
  if (state.claudeBlocks[key]) return state.claudeBlocks[key];
  const block = { index: state.claudeNextIndex || 0, closed: false };
  state.claudeNextIndex = block.index + 1;
  state.claudeBlocks[key] = block;
  results.push({ type: "content_block_start", index: block.index, content_block: contentBlock });
  return block;
}

export function openaiResponsesToClaudeResponse(chunk: any, state: any) {
  if (!chunk) return null;
  const data = chunk.data || chunk;
  const type = chunk.type || chunk.event || data.type;
  const results: any[] = [];
  ensureMessageStart(state, data, results);

  if (type === "response.output_text.delta") {
    stopBlock(state, "thinking", results);
    const block = startBlock(state, "text", { type: CLAUDE_BLOCK.TEXT, text: "" }, results);
    if (data.delta) results.push({ type: "content_block_delta", index: block.index, delta: { type: "text_delta", text: data.delta } });
  } else if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
    stopBlock(state, "text", results);
    const block = startBlock(state, "thinking", { type: CLAUDE_BLOCK.THINKING, thinking: "" }, results);
    if (data.delta) results.push({ type: "content_block_delta", index: block.index, delta: { type: "thinking_delta", thinking: data.delta } });
  } else if (type === "response.output_item.added" && data.item?.type === "reasoning") {
    const block = startBlock(state, "thinking", {
      type: CLAUDE_BLOCK.THINKING,
      thinking: "",
      grok_reasoning_id: data.item.id,
    }, results);
    block.grokReasoningId = data.item.id;
  } else if (type === "response.output_item.added" && (data.item?.type === "function_call" || data.item?.type === "custom_tool_call")) {
    stopBlock(state, "thinking", results);
    stopBlock(state, "text", results);
    const item = data.item;
    const key = `tool:${item.call_id || item.id || data.output_index || 0}`;
    state.claudeToolKeys ||= {};
    if (item.call_id) state.claudeToolKeys[`call:${item.call_id}`] = key;
    if (item.id) state.claudeToolKeys[`item:${item.id}`] = key;
    const block = startBlock(state, key, { type: CLAUDE_BLOCK.TOOL_USE, id: item.call_id || item.id, name: item.name || "", input: {} }, results);
    if (item.arguments) {
      block.argumentsEmitted = true;
      results.push({ type: "content_block_delta", index: block.index, delta: { type: "input_json_delta", partial_json: item.arguments } });
    }
  } else if (type === "response.function_call_arguments.delta" || type === "response.custom_tool_call_input.delta") {
    const key = state.claudeToolKeys?.[`call:${data.call_id}`]
      || state.claudeToolKeys?.[`item:${data.item_id}`]
      || `tool:${data.call_id || data.item_id || data.output_index || 0}`;
    const block = state.claudeBlocks?.[key];
    if (block && data.delta) {
      block.argumentsEmitted = true;
      results.push({ type: "content_block_delta", index: block.index, delta: { type: "input_json_delta", partial_json: data.delta } });
    }
  } else if (type === "response.function_call_arguments.done") {
    const key = state.claudeToolKeys?.[`call:${data.call_id}`]
      || state.claudeToolKeys?.[`item:${data.item_id}`]
      || `tool:${data.call_id || data.item_id || data.output_index || 0}`;
    const block = state.claudeBlocks?.[key];
    if (block && data.arguments && !block.argumentsEmitted) {
      block.argumentsEmitted = true;
      results.push({ type: "content_block_delta", index: block.index, delta: { type: "input_json_delta", partial_json: data.arguments } });
    }
  } else if (type === "response.output_item.done") {
    const item = data.item || {};
    if (item.type === "reasoning") {
      const block = state.claudeBlocks?.thinking;
      if (block && item.encrypted_content) {
        results.push({ type: "content_block_delta", index: block.index, delta: { type: "signature_delta", signature: item.encrypted_content } });
      }
      stopBlock(state, "thinking", results);
    } else if (item.type === "function_call" || item.type === "custom_tool_call") {
      const key = state.claudeToolKeys?.[`call:${item.call_id}`]
        || state.claudeToolKeys?.[`item:${item.id}`]
        || `tool:${item.call_id || item.id || data.output_index || 0}`;
      stopBlock(state, key, results);
    }
  } else if (type === "response.incomplete" || type === "response.completed" || type === "response.done") {
    for (const key of Object.keys(state.claudeBlocks || {})) stopBlock(state, key, results);
    const response = data.response || {};
    const hasTools = Object.keys(state.claudeBlocks || {}).some((key) => key.startsWith("tool:"));
    results.push({
      type: "message_delta",
      delta: { stop_reason: hasTools ? "tool_use" : type === "response.incomplete" ? "max_tokens" : "end_turn" },
      usage: usageFromResponse(response.usage),
    });
    results.push({ type: "message_stop" });
  } else if (type === "response.failed" || type === "response.error" || type === "error") {
    results.push({ type: "error", error: data.error || data.response?.error || { type: "api_error", message: "Grok Responses stream failed" } });
  }
  return results.length ? results : null;
}

register(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, null, openaiResponsesToClaudeResponse);
