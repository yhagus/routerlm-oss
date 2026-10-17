import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { encodeDataUri } from "../concerns/image.js";
import { CLAUDE_BLOCK, RESPONSES_ITEM, ROLE } from "../schema/index.js";
import { ensureStructuredOutputName } from "../concerns/structuredOutput.js";

function contentToText(content: any) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((part) => {
    if (part?.type === CLAUDE_BLOCK.TEXT) return part.text || "";
    return JSON.stringify(part);
  }).join("\n");
}

function sourceToInputPart(block: any) {
  const source = block?.source || {};
  if (block?.type === CLAUDE_BLOCK.IMAGE) {
    if (source.type === "base64" && source.data) {
      return {
        type: RESPONSES_ITEM.INPUT_IMAGE,
        image_url: encodeDataUri(source.media_type || "image/png", source.data),
      };
    }
    if (source.type === "url" && source.url) {
      return { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: source.url };
    }
  }

  if (block?.type === CLAUDE_BLOCK.DOCUMENT) {
    if (source.type === "base64" && source.data) {
      return {
        type: "input_file",
        filename: block.title || "document",
        file_data: encodeDataUri(source.media_type || "application/octet-stream", source.data),
      };
    }
    if (source.type === "url" && source.url) {
      return { type: "input_file", filename: block.title || "document", file_url: source.url };
    }
  }
  return null;
}

function appendMessage(input: any, role: any, parts: any) {
  if (parts.length) input.push({ type: RESPONSES_ITEM.MESSAGE, role, content: parts });
}

function appendClaudeMessage(input: any, message: any) {
  const role = message.role === ROLE.ASSISTANT ? ROLE.ASSISTANT : ROLE.USER;
  if (typeof message.content === "string") {
    appendMessage(input, role, [{ type: role === ROLE.ASSISTANT ? RESPONSES_ITEM.OUTPUT_TEXT : RESPONSES_ITEM.INPUT_TEXT, text: message.content }]);
    return;
  }
  if (!Array.isArray(message.content)) return;

  const parts: any[] = [];
  const calls: any[] = [];
  const results: any[] = [];
  const reasoning: any[] = [];
  for (const block of message.content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === CLAUDE_BLOCK.TEXT) {
      parts.push({ type: role === ROLE.ASSISTANT ? RESPONSES_ITEM.OUTPUT_TEXT : RESPONSES_ITEM.INPUT_TEXT, text: block.text || "" });
    } else if (block.type === CLAUDE_BLOCK.IMAGE || block.type === CLAUDE_BLOCK.DOCUMENT) {
      const part = sourceToInputPart(block);
      if (part) parts.push(part);
    } else if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
      reasoning.push(block);
    } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
      calls.push({
        type: RESPONSES_ITEM.FUNCTION_CALL,
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input || {}),
      });
    } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
      const output = contentToText(block.content);
      results.push({
        type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
        call_id: block.tool_use_id,
        // Responses has no error discriminator. Keep it in structured output so
        // the model can distinguish an errored tool from a successful string.
        output: block.is_error ? JSON.stringify({ is_error: true, content: output }) : output,
      });
    }
  }

  // Grok requires the native item id together with encrypted reasoning. The
  // response translator exposes grok_reasoning_id as an opaque replay field.
  for (const block of reasoning) {
    const encrypted = typeof block.signature === "string" ? block.signature : "";
    const id = typeof block.grok_reasoning_id === "string" ? block.grok_reasoning_id : "";
    if (!encrypted || !id) continue;
    input.push({
      type: RESPONSES_ITEM.REASONING,
      id,
      encrypted_content: encrypted,
      summary: block.thinking ? [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: block.thinking }] : [],
    });
  }
  appendMessage(input, role, parts);
  input.push(...calls, ...results);
}

function convertToolChoice(choice: any) {
  if (!choice || choice.type === "auto") return "auto";
  if (choice.type === "any") return "required";
  if (choice.type === "tool" && choice.name) return { type: "function", name: choice.name };
  return undefined;
}

export function claudeToOpenAIResponsesRequest(model: any, body: any, stream: any) {
  const result: Record<string, any> = { model, input: [] as any[], stream: stream !== false, store: false };
  const system = Array.isArray(body.system)
    ? body.system.map((block: any) => block?.text || "").filter(Boolean).join("\n")
    : typeof body.system === "string" ? body.system : "";
  if (system) result.instructions = system;
  for (const message of body.messages || []) appendClaudeMessage(result.input, message);
  if (result.input.length === 0) {
    result.input.push({ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "..." }] });
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    result.tools = body.tools.map((tool: any) => ({
      type: "function",
      name: tool.name,
      description: tool.description || "",
      parameters: tool.input_schema || { type: "object", properties: {} },
    }));
  }
  const toolChoice = convertToolChoice(body.tool_choice);
  if (toolChoice !== undefined) result.tool_choice = toolChoice;
  if (body.max_tokens !== undefined) result.max_output_tokens = body.max_tokens;
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.output_config?.format?.type === "json_schema") {
    result.text = { format: ensureStructuredOutputName({ type: "json_schema", ...body.output_config.format }) };
  }
  return result;
}

register(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, claudeToOpenAIResponsesRequest, null);
