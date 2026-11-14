import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import type { Database } from "@/db/schemas/relations.js";
import { GATEWAY_ERROR_CODES } from "@/db/schemas/index.js";
import { GATEWAY_ERROR_STATUS } from "@/inference/models/gateway-error.js";
import {
  type CodeBlock,
  codeBlocksOf,
  type DocsPage,
  DOCS_API_KEY_VARIABLE,
  DOCS_BASE_URL,
  DOCS_MODEL_NAME,
  parseCurl,
  proseOf,
  readDocsPages,
} from "./support/docs-examples.js";
import { FakeUpstream, openAiChatFixture } from "./support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel } from "./support/inference.js";
import { portOf } from "./support/port-of.js";
import { createTestApp } from "./support/test-app.js";
import { deleteAllUpstreamData } from "./support/upstream.js";

const pages = readDocsPages();
const codeBlocks = pages.flatMap(codeBlocksOf);
const curlExamples = codeBlocks.filter((block) => block.language === "bash");
const sdkExamples = codeBlocks.filter((block) => block.language === "ts");

/**
 * The one exception to "the docs name no Provider" (ADR 0006): the client
 * examples import these Providers' SDKs, so their names may appear in code.
 * Prose stays Provider-free, and no other Provider name may appear in code.
 */
const SDK_OWNERS = ["OpenAI", "Anthropic"];
/** The Model name the errors page uses to show a `model_not_found` envelope. */
const UNKNOWN_MODEL_NAME = "unknown-model";

/** SDK snippets are written here so they import the SDKs from this repo's node_modules. */
const SNIPPET_DIRECTORY = new URL("./.docs-examples/", import.meta.url);

function errorsPage(): DocsPage {
  const page = pages.find(({ fileName }) => fileName.endsWith("errors.md"));
  if (!page) throw new Error("The docs have no errors page");
  return page;
}

function nameOf(block: CodeBlock): string {
  return `${block.fileName} example ${block.position}`;
}

/** Streams are replied to with a recorded stream, everything else with a recorded response. */
function replyFor(upstream: FakeUpstream, block: CodeBlock): void {
  if (/stream/.test(block.code)) {
    upstream.reply({ kind: "stream", events: openAiChatFixture("upstream-stream-tool-call.sse") });
  } else {
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });
  }
}

describe("Client documentation (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let gatewayUrl: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
    const server = await app.listen(0, "127.0.0.1");
    gatewayUrl = `http://127.0.0.1:${portOf(server.address())}`;
    mkdirSync(SNIPPET_DIRECTORY, { recursive: true });
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    await insertOpenAiChatModel(app, db, { modelName: DOCS_MODEL_NAME, baseUrl: upstream.baseUrl });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    rmSync(SNIPPET_DIRECTORY, { recursive: true, force: true });
    await upstream.close();
    await app.close();
  });

  it("has curl and SDK examples to run", () => {
    expect(curlExamples.length).toBeGreaterThan(0);
    expect(sdkExamples.length).toBeGreaterThan(0);
  });

  it.each(curlExamples.map((block) => [nameOf(block), block] as const))(
    "%s works as written",
    async (_name, block) => {
      replyFor(upstream, block);
      const curl = parseCurl(block.code, { [DOCS_API_KEY_VARIABLE]: apiKey });

      const response = await fetch(curl.url.replace(DOCS_BASE_URL, gatewayUrl), {
        method: curl.method,
        headers: curl.headers,
        body: curl.body,
      });
      const text = await response.text();

      expect({ status: response.status, text }).toMatchObject({ status: 200 });
      // A stream that failed midway still answers 200, then ends with an error envelope.
      expect(text).not.toMatch(/event: error|"error":\{/);
    },
  );

  it.each(sdkExamples.map((block) => [nameOf(block), block] as const))(
    "%s works as written",
    async (_name, block) => {
      replyFor(upstream, block);
      vi.stubEnv(DOCS_API_KEY_VARIABLE, apiKey);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const file = new URL(`${block.fileName}-${block.position}.ts`, SNIPPET_DIRECTORY);
      writeFileSync(file, block.code.replaceAll(DOCS_BASE_URL, gatewayUrl));

      try {
        await import(fileURLToPath(file));
      } finally {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
      }
    },
  );

  it("lists every error code with its HTTP status", () => {
    const tableRows = GATEWAY_ERROR_CODES.map((code) =>
      errorsPage().markdown.includes(`| ${GATEWAY_ERROR_STATUS[code]} | \`${code}\` |`),
    );

    expect(tableRows).toEqual(GATEWAY_ERROR_CODES.map(() => true));
  });

  it("shows the error envelopes each Protocol actually returns", async () => {
    const [chatEnvelope, messagesEnvelope] = codeBlocksOf(errorsPage())
      .filter((block) => block.language === "json")
      .map((block): unknown => JSON.parse(block.code));
    const unknownModelRequest = (path: string) =>
      fetch(`${gatewayUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: UNKNOWN_MODEL_NAME,
          max_tokens: 1024,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

    const chatResponse = await unknownModelRequest("/v1/chat/completions");
    const messagesResponse = await unknownModelRequest("/v1/messages");

    expect(await chatResponse.json()).toEqual(chatEnvelope);
    expect(await messagesResponse.json()).toEqual(messagesEnvelope);
  });

  it("names no Provider", async () => {
    const providerNames = (await loadCatalog(CATALOG_DIRECTORY)).map((provider) => provider.name);
    const namesInCode = providerNames.filter((name) => !SDK_OWNERS.includes(name));

    const named = pages.flatMap((page) => {
      const prose = proseOf(page).toLowerCase();
      const code = codeBlocksOf(page)
        .map((block) => block.code)
        .join("\n")
        .toLowerCase();
      return [
        ...providerNames.filter((name) => prose.includes(name.toLowerCase())),
        ...namesInCode.filter((name) => code.includes(name.toLowerCase())),
      ].map((name) => `${page.fileName}: ${name}`);
    });

    expect(named).toEqual([]);
  });
});
