import type { Capability } from "../db/schema.js";
import type { SnapshotModel, SnapshotRoute } from "../snapshot/snapshot.js";
import type { InferenceRequest } from "./internal-format.js";
import { capableRoutes } from "./route-selection.js";

const TEXT_REQUEST: InferenceRequest = {
  model: "smart",
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  stream: null,
};

function route(
  id: string,
  capabilities: Capability[],
  overrides: {
    isEnabled?: boolean;
    contextSize?: number;
  } = {},
): SnapshotRoute {
  return {
    id,
    priority: 0,
    isEnabled: overrides.isEnabled ?? true,
    parameterPolicyOverride: null,
    connectTimeoutMs: null,
    firstTokenTimeoutMs: null,
    totalTimeoutMs: null,
    upstreamModel: {
      id: `${id}-upstream`,
      upstreamModelId: `${id}-model`,
      capabilities,
      contextSize: overrides.contextSize ?? 128_000,
      maxOutputTokens: null,
      inputPrice: null,
      outputPrice: null,
      cacheReadPrice: null,
      cacheWritePrice: null,
      isEnabled: true,
      provider: {
        id: `${id}-provider`,
        slug: id,
        protocol: "openai-chat",
        baseUrl: "https://api.example",
        authStyle: "bearer",
        quirks: {},
        isEnabled: true,
        providerAccounts: [],
      },
    },
  };
}

function modelWith(...routes: SnapshotRoute[]): SnapshotModel {
  return {
    id: "model-1",
    name: "smart",
    isEnabled: true,
    parameterPolicy: {},
    hasAutomaticCacheBreakpoints: true,
    createdAt: new Date(),
    routes,
  };
}

describe("capableRoutes", () => {
  it("keeps the Routes' order and skips disabled ones", () => {
    const model = modelWith(
      route("first", []),
      route("off", [], { isEnabled: false }),
      route("last", []),
    );

    expect(capableRoutes(model, TEXT_REQUEST).map((candidate) => candidate.id)).toEqual([
      "first",
      "last",
    ]);
  });

  it("skips Routes whose Upstream Model lacks a Capability the request needs", () => {
    const request: InferenceRequest = {
      ...TEXT_REQUEST,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: "https://images.example/cat.jpg" } },
          ],
        },
      ],
      tools: [{ name: "get_weather", parameters: { type: "object" } }],
      responseFormat: { type: "json-schema", name: "answer", schema: {} },
      reasoning: { effort: "high" },
    };
    const model = modelWith(
      route("text-only", []),
      route("no-reasoning", ["vision", "tools", "structured-output"]),
      route("everything", ["vision", "tools", "structured-output", "reasoning"]),
    );

    expect(capableRoutes(model, request).map((candidate) => candidate.id)).toEqual(["everything"]);
  });

  it("skips Routes whose context is too small for the prompt and the requested output", () => {
    // About 100 prompt tokens (4 characters each) plus 3 950 output tokens.
    const request: InferenceRequest = {
      ...TEXT_REQUEST,
      messages: [{ role: "user", content: [{ type: "text", text: "word".repeat(100) }] }],
      maxOutputTokens: 3_950,
    };
    const model = modelWith(route("small", [], { contextSize: 4_000 }), route("large", []));

    expect(capableRoutes(model, request).map((candidate) => candidate.id)).toEqual(["large"]);
  });
});
