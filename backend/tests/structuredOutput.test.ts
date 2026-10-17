import { describe, expect, test } from "bun:test";
import { ensureStructuredOutputName } from "../src/services/chat/translator/concerns/structuredOutput.js";
import { claudeToOpenAIResponsesRequest } from "../src/services/chat/translator/request/claude-to-openai-responses.js";
import { openaiToOpenAIResponsesRequest } from "../src/services/chat/translator/request/openai-responses.js";
import { CodexExecutor } from "../src/services/chat/executors/codex.js";

const SCHEMA = { type: "object", properties: { answer: { type: "string" } } };

describe("structured output name synthesis", () => {
  test("helper synthesizes from schema.title", () => {
    const format = ensureStructuredOutputName({ type: "json_schema", schema: { title: "math_response" } });
    expect(format.name).toBe("math_response");
  });

  test("helper synthesizes a valid name from schema.$id and clamps length", () => {
    const format = ensureStructuredOutputName({
      type: "json_schema",
      schema: { $id: `https://example.com/${"a".repeat(100)}` },
    });
    expect(typeof format.name).toBe("string");
    expect(format.name.length).toBeLessThanOrEqual(64);
    expect(format.name).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });

  test("helper falls back to a constant when schema has no title or $id", () => {
    const format = ensureStructuredOutputName({ type: "json_schema", schema: SCHEMA });
    expect(format.name).toBe("structured_output");
  });

  test("helper preserves an explicit client-provided name", () => {
    const format = ensureStructuredOutputName({ type: "json_schema", name: "client_name", schema: SCHEMA });
    expect(format.name).toBe("client_name");
  });

  test("helper leaves non-json_schema formats unchanged", () => {
    const format = { type: "json_object" };
    expect(ensureStructuredOutputName(format)).toBe(format);
  });

  test("claude output_config.format json_schema yields text.format.name and preserves schema", () => {
    const result = claudeToOpenAIResponsesRequest("gpt-5.5", {
      messages: [{ role: "user", content: "hello" }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    }, true);

    expect(result.text?.format?.type).toBe("json_schema");
    expect(result.text?.format?.name).toBe("structured_output");
    expect(result.text?.format?.schema).toEqual(SCHEMA);
  });

  test("chat-completions response_format json_schema converts to text.format with a synthesized name", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-5.5", {
      messages: [{ role: "user", content: "hello" }],
      response_format: { type: "json_schema", json_schema: { schema: SCHEMA, strict: true } },
    }, true, null);

    expect(result.text?.format?.type).toBe("json_schema");
    expect(result.text?.format?.name).toBe("structured_output");
    expect(result.text?.format?.schema).toEqual(SCHEMA);
    expect(result.text?.format?.strict).toBe(true);
  });

  test("chat-completions response_format preserves an explicit json_schema.name", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-5.5", {
      messages: [{ role: "user", content: "hello" }],
      response_format: { type: "json_schema", json_schema: { name: "quiz", schema: SCHEMA } },
    }, true, null);

    expect(result.text?.format?.name).toBe("quiz");
    expect(result.text?.format?.schema).toEqual(SCHEMA);
  });

  test("codex transformRequest synthesizes text.format.name when absent", () => {
    const executor = new CodexExecutor();
    const body: { text: { format: { type: string; name?: string; schema: typeof SCHEMA } } } & Record<string, unknown> = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      text: { format: { type: "json_schema", schema: SCHEMA } },
    };

    executor.transformRequest("gpt-5.5", body, true, null);

    expect(body.text?.format?.name).toBe("structured_output");
    expect(body.text?.format?.schema).toEqual(SCHEMA);
  });

  test("codex transformRequest preserves an explicit text.format.name", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      text: { format: { type: "json_schema", name: "explicit", schema: SCHEMA } },
    };

    executor.transformRequest("gpt-5.5", body, true, null);

    expect(body.text?.format?.name).toBe("explicit");
    expect(body.text?.format?.schema).toEqual(SCHEMA);
  });
});
