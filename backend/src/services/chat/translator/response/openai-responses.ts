/**
 * Translator: OpenAI Chat Completions → OpenAI Responses API (response)
 * Converts streaming chunks from Chat Completions to Responses API events
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { buildChunk } from "../concerns/chunk.js";
import { buildUsage } from "../concerns/usage.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { reasoningDelta, extractReasoningText } from "../concerns/reasoning.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM, OPENAI_FINISH, MODEL_FALLBACK } from "../schema/index.js";

/**
 * Translate OpenAI chunk to Responses API events
 * @returns {Array} Array of events with { event, data } structure
 */
export function openaiToOpenAIResponsesResponse(chunk: any, state: any) {
  if (!chunk) {
    return flushEvents(state);
  }
  
  if (!chunk.choices?.length) return [];
  
  const events: any[] = [];
  const nextSeq = () => ++state.seq;
  
  const emit = (eventType: any, data: any) => {
    data.sequence_number = nextSeq();
    events.push({ event: eventType, data });
  };

  const choice = chunk.choices[0];
  const idx = choice.index || 0;
  const delta = choice.delta || {};

  // Emit initial events
  if (!state.started) {
    state.started = true;
    state.responseId = chunk.id ? `resp_${chunk.id}` : state.responseId;
    
    emit("response.created", {
      type: "response.created",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "in_progress",
        background: false,
        error: null,
        output: [] as any[]}
    });

    emit("response.in_progress", {
      type: "response.in_progress",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "in_progress"
      }
    });
  }

  // Handle reasoning across vendor shapes (reasoning_content / reasoning / reasoning_details)
  const reasoningText = extractReasoningText(delta);
  if (reasoningText) {
    startReasoning(state, emit, idx);
    emitReasoningDelta(state, emit, reasoningText);
  }

  // Handle text content
  if (delta.content) {
    let content = delta.content;

    if (content.includes("<think>")) {
      state.inThinking = true;
      content = content.replace("<think>", "");
      startReasoning(state, emit, idx);
    }

    if (content.includes("</think>")) {
      const parts = content.split("</think>");
      const thinkPart = parts[0];
      const textPart = parts.slice(1).join("</think>");
      if (thinkPart) emitReasoningDelta(state, emit, thinkPart);
      closeReasoning(state, emit);
      state.inThinking = false;
      content = textPart;
    }

    if (state.inThinking && content) {
      emitReasoningDelta(state, emit, content);
      return events;
    }

    if (content) {
      emitTextContent(state, emit, idx, content);
    }
  }

  // Handle tool_calls
  if (delta.tool_calls) {
    closeMessage(state, emit, idx);
    for (const tc of delta.tool_calls) {
      emitToolCall(state, emit, tc);
    }
  }

  // Handle finish_reason
  if (choice.finish_reason) {
    for (const i in state.msgItemAdded) closeMessage(state, emit, i);
    closeReasoning(state, emit);
    for (const i in state.funcCallIds) closeToolCall(state, emit, i);
    sendCompleted(state, emit);
  }

  return events;
}

// Helper functions
function startReasoning(state: any, emit: any, idx: any) {
  if (!state.reasoningId) {
    state.reasoningId = `rs_${state.responseId}_${idx}`;
    state.reasoningIndex = idx;
    
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: idx,
      item: { id: state.reasoningId, type: RESPONSES_ITEM.REASONING, summary: [] as any[]}
    });

    emit("response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      item_id: state.reasoningId,
      output_index: idx,
      summary_index: 0,
      part: { type: RESPONSES_ITEM.SUMMARY_TEXT, text: "" }
    });
    state.reasoningPartAdded = true;
  }
}

function emitReasoningDelta(state: any, emit: any, text: any) {
  if (!text) return;
  state.reasoningBuf += text;
  emit("response.reasoning_summary_text.delta", {
    type: "response.reasoning_summary_text.delta",
    item_id: state.reasoningId,
    output_index: state.reasoningIndex,
    summary_index: 0,
    delta: text
  });
}

function closeReasoning(state: any, emit: any) {
  if (state.reasoningId && !state.reasoningDone) {
    state.reasoningDone = true;
    
    emit("response.reasoning_summary_text.done", {
      type: "response.reasoning_summary_text.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      text: state.reasoningBuf
    });

    emit("response.reasoning_summary_part.done", {
      type: "response.reasoning_summary_part.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      part: { type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: state.reasoningIndex,
      item: {
        id: state.reasoningId,
        type: RESPONSES_ITEM.REASONING,
        summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }]
      }
    });
  }
}

function emitTextContent(state: any, emit: any, idx: any, content: any) {
  if (!state.msgItemAdded[idx]) {
    state.msgItemAdded[idx] = true;
    const msgId = `msg_${state.responseId}_${idx}`;
    
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: idx,
      item: { id: msgId, type: RESPONSES_ITEM.MESSAGE, content: [] as any[], role: ROLE.ASSISTANT }
    });
  }

  if (!state.msgContentAdded[idx]) {
    state.msgContentAdded[idx] = true;
    
    emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: `msg_${state.responseId}_${idx}`,
      output_index: idx,
      content_index: 0,
      part: { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [] as any[], logprobs: [] as any[], text: "" }
    });
  }

  emit("response.output_text.delta", {
    type: "response.output_text.delta",
    item_id: `msg_${state.responseId}_${idx}`,
    output_index: idx,
    content_index: 0,
    delta: content,
    logprobs: [] as any[]});

  if (!state.msgTextBuf[idx]) state.msgTextBuf[idx] = "";
  state.msgTextBuf[idx] += content;
}

function closeMessage(state: any, emit: any, idx: any) {
  if (state.msgItemAdded[idx] && !state.msgItemDone[idx]) {
    state.msgItemDone[idx] = true;
    const fullText = state.msgTextBuf[idx] || "";
    const msgId = `msg_${state.responseId}_${idx}`;

    emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: msgId,
      output_index: parseInt(idx),
      content_index: 0,
      text: fullText,
      logprobs: [] as any[]});

    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: msgId,
      output_index: parseInt(idx),
      content_index: 0,
      part: { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [] as any[], logprobs: [] as any[], text: fullText }
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: parseInt(idx),
      item: {
        id: msgId,
        type: RESPONSES_ITEM.MESSAGE,
        content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [] as any[], logprobs: [] as any[], text: fullText }],
        role: ROLE.ASSISTANT
      }
    });
  }
}

function emitToolCall(state: any, emit: any, tc: any) {
  const tcIdx = tc.index ?? 0;
  const newCallId = tc.id;
  const funcName = tc.function?.name;

  if (funcName) state.funcNames[tcIdx] = funcName;

  if (!state.funcCallIds[tcIdx] && newCallId) {
    state.funcCallIds[tcIdx] = newCallId;
    
    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: tcIdx,
      item: {
        id: `fc_${newCallId}`,
        type: RESPONSES_ITEM.FUNCTION_CALL,
        arguments: "",
        call_id: newCallId,
        name: state.funcNames[tcIdx] || ""
      }
    });
  }

  if (!state.funcArgsBuf[tcIdx]) state.funcArgsBuf[tcIdx] = "";

  if (tc.function?.arguments) {
    const refCallId = state.funcCallIds[tcIdx] || newCallId;
    if (refCallId) {
      emit("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: `fc_${refCallId}`,
        output_index: tcIdx,
        delta: tc.function.arguments
      });
    }
    state.funcArgsBuf[tcIdx] += tc.function.arguments;
  }
}

function closeToolCall(state: any, emit: any, idx: any) {
  const callId = state.funcCallIds[idx];
  if (callId && !state.funcItemDone[idx]) {
    const args = state.funcArgsBuf[idx] || "{}";
    
    emit("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: `fc_${callId}`,
      output_index: parseInt(idx),
      arguments: args
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: parseInt(idx),
      item: {
        id: `fc_${callId}`,
        type: RESPONSES_ITEM.FUNCTION_CALL,
        arguments: args,
        call_id: callId,
        name: state.funcNames[idx] || ""
      }
    });

    state.funcItemDone[idx] = true;
    state.funcArgsDone[idx] = true;
  }
}

function sendCompleted(state: any, emit: any) {
  if (!state.completedSent) {
    state.completedSent = true;
    emit("response.completed", {
      type: "response.completed",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "completed",
        background: false,
        error: null
      }
    });
  }
}

function flushEvents(state: any) {
  if (state.completedSent) return [];
  
  const events: any[] = [];
  const nextSeq = () => ++state.seq;
  const emit = (eventType: any, data: any) => {
    data.sequence_number = nextSeq();
    events.push({ event: eventType, data });
  };

  for (const i in state.msgItemAdded) closeMessage(state, emit, i);
  closeReasoning(state, emit);
  for (const i in state.funcCallIds) closeToolCall(state, emit, i);
  sendCompleted(state, emit);
  
  return events;
}

// currentToolCallId is intentionally sticky for the current turn so flush/completion
  // can still finalize as tool_calls even if the tool call was emitted before stream end.
function computeFinishReason(state: any) {
    return state.toolCallIndex > 0 || state.currentToolCallId
     ? OPENAI_FINISH.TOOL_CALLS
     : OPENAI_FINISH.STOP;
}

function getResponseToolCallIndex(state: any, data: any, item: any = null) {
  if (!state.responseToolIndexes) state.responseToolIndexes = new Map();
  if (!state.responseToolIds) state.responseToolIds = new Map();

  const responseIndex = Number.isInteger(data?.output_index) ? data.output_index : null;
  const callId = item?.call_id || data?.call_id;
  const itemId = item?.id || data?.item_id;
  const keys = [
    responseIndex == null ? null : `output:${responseIndex}`,
    callId ? `call:${callId}` : null,
    itemId ? `item:${itemId}` : null,
    state.currentToolCallId && !callId && !itemId ? `call:${state.currentToolCallId}` : null,
  ].filter(Boolean);

  for (const key of keys) {
    const existing = state.responseToolIndexes.get(key);
    if (existing !== undefined) return existing;
  }

  const index = state.toolCallIndex++;
  for (const key of keys) state.responseToolIndexes.set(key, index);
  if (callId) state.responseToolIds.set(callId, index);
  return index;
}

function emitResponseToolCallStart(state: any, data: any, item: any) {
  const index = getResponseToolCallIndex(state, data, item);
  const callId = item?.call_id || data?.call_id || fallbackToolCallId();
  const key = `started:${index}`;
  if (state.responseToolIndexes.get(key)) return { index, callId };

  state.responseToolIndexes.set(key, true);
  state.currentToolCallId = callId;
  return {
    index,
    callId,
    chunk: buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      {
        tool_calls: [{
          index,
          id: callId,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: item?.name || "", arguments: "" },
        }],
      },
    ),
  };
}

function appendResponseToolArguments(state: any, index: any, args: any) {
  if (!state.responseToolArguments) state.responseToolArguments = {};
  state.responseToolArguments[index] = (state.responseToolArguments[index] || "") + args;
}

/**
 * Translate OpenAI Responses API chunk to OpenAI Chat Completions format
 * This is for when Codex returns data and we need to send it to an OpenAI-compatible client
 */
export function openaiResponsesToOpenAIResponse(chunk: any, state: any) {
  if (!chunk) {
    // Flush: send final chunk with finish_reason
    if (state.finishReasonSent || !state.started) return null;

    const finishReason = computeFinishReason(state);

    state.finishReasonSent = true;
    state.finishReason = finishReason;

    const finalChunk = buildChunk(
      { id: state.chatId || `chatcmpl-${Date.now()}`, created: state.created || Math.floor(Date.now() / 1000), model: state.model || MODEL_FALLBACK },
      {},
      finishReason
    );

    if (state.usage && typeof state.usage === "object") {
      (finalChunk as any).usage = state.usage;
    }

    return finalChunk;
  }

  // Handle different event types from Responses API
  const eventType = chunk.type || chunk.event;
  const data = chunk.data || chunk;

  // Initialize state
  if (!state.started) {
    state.started = true;
    state.chatId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.toolCallIndex = 0;
    state.currentToolCallId = null;
  }

  // Text content delta
  if (eventType === "response.output_text.delta") {
    const delta = data.delta || "";
    if (!delta) return null;

    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { content: delta }
    );
  }

  // Text content done (ignore, we handle via delta)
  if (eventType === "response.output_text.done") {
    return null;
  }

  // Function call started (standard function_call or custom_tool_call)
  if (eventType === "response.output_item.added" && (data.item?.type === RESPONSES_ITEM.FUNCTION_CALL || data.item?.type === "custom_tool_call")) {
    const item = data.item;
    const started = emitResponseToolCallStart(state, data, item);
    if (item.arguments) {
      appendResponseToolArguments(state, started.index, item.arguments);
      if (started.chunk) {
        started.chunk.choices[0].delta.tool_calls[0].function.arguments = item.arguments;
      }
    }
    return started.chunk || null;
  }

  // Function call arguments delta (standard or custom_tool_call variant)
  if (eventType === "response.function_call_arguments.delta" || eventType === "response.custom_tool_call_input.delta") {
    const argsDelta = data.delta || "";
    if (!argsDelta) return null;

    const started = emitResponseToolCallStart(state, data, data.item);
    appendResponseToolArguments(state, started.index, argsDelta);
    if (started.chunk) {
      started.chunk.choices[0].delta.tool_calls[0].function.arguments = argsDelta;
      return started.chunk;
    }

    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { tool_calls: [{ index: started.index, function: { arguments: argsDelta } }] }
    );
  }

  // Some Responses implementations send the complete arguments only in the
  // terminal event. Emit them once so Chat Completions clients can reconstruct
  // the call even when no delta events were received.
  if (eventType === "response.function_call_arguments.done") {
    const args = typeof data.arguments === "string" ? data.arguments : "";
    const started = emitResponseToolCallStart(state, data, data.item);
    const existing = state.responseToolArguments?.[started.index] || "";
    if (args && !existing) {
      appendResponseToolArguments(state, started.index, args);
      if (started.chunk) {
        started.chunk.choices[0].delta.tool_calls[0].function.arguments = args;
        return started.chunk;
      }
      return buildChunk(
        { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
        { tool_calls: [{ index: started.index, function: { arguments: args } }] },
      );
    }
    return started.chunk || null;
  }

  // Store=false Responses turns return the encrypted reasoning continuation
  // token on the completed reasoning item. Forward it through the Chat delta
  // so the next request can replay it.
  if (eventType === "response.output_item.done" && data.item?.type === RESPONSES_ITEM.REASONING) {
    const encrypted = data.item.encrypted_content || data.item.encryptedContent;
    if (typeof encrypted !== "string" || !encrypted || state.encryptedContentSent) return null;
    state.encryptedContentSent = true;
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      { encrypted_content: encrypted },
    );
  }

  // Function call done (standard or custom_tool_call variant)
  if (eventType === "response.output_item.done" && (data.item?.type === RESPONSES_ITEM.FUNCTION_CALL || data.item?.type === "custom_tool_call")) {
    const item = data.item;
    const started = emitResponseToolCallStart(state, data, item);
    if (item.arguments && !(state.responseToolArguments?.[started.index] || "")) {
      appendResponseToolArguments(state, started.index, item.arguments);
      if (started.chunk) {
        started.chunk.choices[0].delta.tool_calls[0].function.arguments = item.arguments;
        return started.chunk;
      }
      return buildChunk(
        { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
        { tool_calls: [{ index: started.index, function: { arguments: item.arguments } }] },
      );
    }
    return null;
  }

  // Response completed
  if (eventType === "response.completed" || eventType === "response.done") {
    // Extract usage from response.completed event
    const responseUsage = data.response?.usage;
    if (responseUsage && typeof responseUsage === "object") {
      const inputTokens = responseUsage.input_tokens || responseUsage.prompt_tokens || 0;
      const outputTokens = responseUsage.output_tokens || responseUsage.completion_tokens || 0;
      // OpenAI Responses API: input_tokens already includes cached_tokens
      // Cache info is in input_tokens_details.cached_tokens
      const cacheReadTokens = responseUsage.input_tokens_details?.cached_tokens || responseUsage.cache_read_input_tokens || 0;
      
      state.usage = buildUsage({ promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens, cachedTokens: cacheReadTokens });
    }
    
    if (!state.finishReasonSent) {
      const finishReason = computeFinishReason(state);

      state.finishReasonSent = true;
      state.finishReason = finishReason; // Mark for usage injection in stream.js
      
      const finalChunk = buildChunk(
        { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
        {},
        finishReason
      );

      // Include usage in final chunk if available
      if (state.usage && typeof state.usage === "object") {
        (finalChunk as any).usage = state.usage;
      }
      
      return finalChunk;
    }
    return null;
  }

  // Error events from Responses API (e.g. model_not_found)
  if (eventType === "error" || eventType === "response.failed") {
    // Avoid emitting duplicate errors (error + response.failed arrive back-to-back)
    if (state.finishReasonSent) return null;

    const error = data.error || data.response?.error;
    if (error) {
      state.error = error;
      state.finishReasonSent = true;

      // Surface the error as an OpenAI-compatible error chunk
      return buildChunk(
        { id: state.chatId || `chatcmpl-${Date.now()}`, created: state.created || Math.floor(Date.now() / 1000), model: state.model || MODEL_FALLBACK },
        { content: `[Error] ${error.message || JSON.stringify(error)}` },
        OPENAI_FINISH.STOP
      );
    }
    return null;
  }

  // Reasoning summary delta → emit as reasoning_content for client thinking display
  if (eventType === "response.reasoning_summary_text.delta" || eventType === "response.reasoning_text.delta") {
    const delta = data.delta || "";
    if (!delta) return null;
    return buildChunk(
      { id: state.chatId, created: state.created, model: state.model || MODEL_FALLBACK },
      reasoningDelta(delta)
    );
  }

  // Ignore other events
  return null;
}

// Register both directions
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, openaiToOpenAIResponsesResponse);
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, null, openaiResponsesToOpenAIResponse);
