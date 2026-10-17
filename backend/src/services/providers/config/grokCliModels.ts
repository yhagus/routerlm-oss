export const GROK_CLI_MODELS = {
  "grok-build": {
    id: "grok-build",
    name: "Grok Build",
    provider: "grok-cli",
    contextLength: 500000,
    maxOutputTokens: 64000,
    inputPrice: 0.50,
    outputPrice: 2.00,
    cachedPrice: 0.25,
    reasoningPrice: 3.00,
    cacheCreationPrice: 0.50,
    supportsReasoning: true,
    supportsReasoningEffort: true,
    supportsVideo: false,
    supportsImage: true,
    supportsCode: true,
    autoCompactThresholdPercent: 80,
    compactionsRemaining: 1,
    compactionAtTokens: true,
    streamToolCalls: false,
    isDefault: true,
    description: "Grok Build (cli-chat-proxy.grok.com) — Grok 4.5 with 500k context",
  },

  "grok-4.5": {
    id: "grok-4.5",
    name: "Grok 4.5",
    provider: "grok-cli",
    contextLength: 500000,
    maxOutputTokens: 64000,
    inputPrice: 0.50,
    outputPrice: 2.00,
    cachedPrice: 0.25,
    reasoningPrice: 3.00,
    cacheCreationPrice: 0.50,
    supportsReasoning: true,
    supportsReasoningEffort: true,
    supportsVideo: false,
    supportsImage: true,
    supportsCode: true,
    autoCompactThresholdPercent: 80,
    compactionsRemaining: 1,
    compactionAtTokens: true,
    streamToolCalls: false,
    isDefault: true,
  },

  "grok-4.5-high": {
    id: "grok-4.5-high",
    name: "Grok 4.5 (High)",
    upstreamModelId: "grok-4.5",
    contextLength: 500000,
    maxOutputTokens: 64000,
    inputPrice: 0.50,
    outputPrice: 2.00,
    cachedPrice: 0.25,
    reasoningPrice: 3.00,
    cacheCreationPrice: 0.50,
    supportsReasoning: true,
    supportsReasoningEffort: true,
    autoCompactThresholdPercent: 80,
    compactionsRemaining: 1,
    compactionAtTokens: true,
    streamToolCalls: false,
    isEffortModel: true,
  },

  "grok-4.5-medium": {
    id: "grok-4.5-medium",
    name: "Grok 4.5 (Medium)",
    upstreamModelId: "grok-4.5",
    contextLength: 500000,
    maxOutputTokens: 64000,
    inputPrice: 0.50,
    outputPrice: 2.00,
    cachedPrice: 0.25,
    reasoningPrice: 3.00,
    cacheCreationPrice: 0.50,
    supportsReasoning: true,
    supportsReasoningEffort: true,
    autoCompactThresholdPercent: 80,
    compactionsRemaining: 1,
    compactionAtTokens: true,
    streamToolCalls: false,
    isEffortModel: true,
  },

  "grok-4.5-low": {
    id: "grok-4.5-low",
    name: "Grok 4.5 (Low)",
    upstreamModelId: "grok-4.5",
    contextLength: 500000,
    maxOutputTokens: 64000,
    inputPrice: 0.50,
    outputPrice: 2.00,
    cachedPrice: 0.25,
    reasoningPrice: 3.00,
    cacheCreationPrice: 0.50,
    supportsReasoning: true,
    supportsReasoningEffort: true,
    autoCompactThresholdPercent: 80,
    compactionsRemaining: 1,
    compactionAtTokens: true,
    streamToolCalls: false,
    isEffortModel: true,
  },

  "grok-code-fast-1": {
    id: "grok-code-fast-1",
    name: "Grok Code Fast 1",
    provider: "grok-cli",
    contextLength: 128000,
    maxOutputTokens: 8000,
    inputPrice: 0.50,
    outputPrice: 2.00,
    cachedPrice: 0.25,
    reasoningPrice: 3.00,
    cacheCreationPrice: 0.50,
    supportsReasoning: true,
    supportsCode: true,
    isCodeModel: true,
  },

  "grok-code-fast-2": {
    id: "grok-code-fast-2",
    name: "Grok Code Fast 2",
    provider: "grok-cli",
    contextLength: 128000,
    maxOutputTokens: 8000,
    inputPrice: 0.50,
    outputPrice: 2.00,
    cachedPrice: 0.25,
    reasoningPrice: 3.00,
    cacheCreationPrice: 0.50,
    supportsReasoning: true,
    supportsCode: true,
    isCodeModel: true,
  },
};

export function getGrokCliModelInfo(modelId: any) {
  return (GROK_CLI_MODELS as Record<string, any>)[modelId] || { id: modelId, contextLength: 256000 };
}

export function parseGrokCliModelsEnhanced(data: any) {
  const models: any[] = [];
  const value = Array.isArray(data)
    ? data
    : data?.data ?? data?.models ?? data?.results ?? data;
  const entries = Array.isArray(value)
    ? value.map((item) => [null, item])
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, any>)
      : [];

  for (const [key, raw] of entries) {
    const item = typeof raw === "string" ? { id: raw } : raw;
    if (!item || typeof item !== "object") continue;

    const id = String(
      item.id ?? item.model_id ?? item.modelId ?? item.model ?? item.slug ?? key ?? item.name ?? "",
    ).trim();
    if (!id) continue;

    const meta = item._meta && typeof item._meta === "object" ? item._meta : {};
    const value = (name: any) => item[name] ?? meta[name];
    const base = getGrokCliModelInfo(id);
    const contextLength = value("context_length")
      ?? value("context_window")
      ?? value("contextLength")
      ?? value("contextWindow")
      ?? value("totalContextTokens")
      ?? base.contextLength;
    const maxOutputTokens = value("max_output_tokens")
      ?? value("max_completion_tokens")
      ?? value("maxOutputTokens")
      ?? value("maxCompletionTokens")
      ?? base.maxOutputTokens;
    const supportsReasoning = value("supports_reasoning")
      ?? value("supportsReasoning")
      ?? value("supports_reasoning_effort")
      ?? value("supportsReasoningEffort")
      ?? base.supportsReasoning;
    const supportsTools = value("supports_tools") ?? value("supportsTools");
    const supportsSearch = value("supports_backend_search") ?? value("supportsBackendSearch");
    const model = {
      ...base,
      ...item,
      id,
      name: item.display_name ?? item.displayName ?? item.name ?? base.name ?? id,
      contextLength,
      maxOutputTokens,
      inputPrice: item.input_price ?? item.inputPrice ?? base.inputPrice,
      outputPrice: item.output_price ?? item.outputPrice ?? base.outputPrice,
      cachedPrice: item.cached_price ?? item.cachedPrice ?? base.cachedPrice,
      reasoningPrice: item.reasoning_price ?? item.reasoningPrice ?? base.reasoningPrice,
      cacheCreationPrice: item.cache_creation_price
        ?? item.cacheCreationPrice
        ?? base.cacheCreationPrice,
      supportsReasoning,
      supportsReasoningEffort: value("supports_reasoning_effort")
        ?? value("supportsReasoningEffort")
        ?? base.supportsReasoningEffort,
      supportsVideo: item.supports_video ?? item.supportsVideo ?? base.supportsVideo,
      supportsImage: item.supports_image ?? item.supportsImage ?? base.supportsImage,
      supportsCode: item.supports_code ?? item.supportsCode ?? base.supportsCode,
      isEffortModel: item.is_effort_model ?? item.isEffortModel ?? base.isEffortModel,
      isDefault: item.is_default ?? item.isDefault ?? base.isDefault,
      apiBackend: value("api_backend") ?? value("apiBackend"),
      reasoningEffort: value("reasoning_effort") ?? value("reasoningEffort"),
      reasoningEfforts: value("reasoning_efforts") ?? value("reasoningEfforts"),
      streamToolCalls: value("stream_tool_calls") ?? value("streamToolCalls"),
      supportsBackendSearch: supportsSearch,
      compactionsRemaining: value("compactions_remaining") ?? value("compactionsRemaining"),
      compactionAtTokens: value("compaction_at_tokens") ?? value("compactionAtTokens"),
      autoCompactThresholdPercent: value("auto_compact_threshold_percent") ?? value("autoCompactThresholdPercent"),
      hidden: value("hidden") === true,
      supportedInApi: value("supported_in_api") ?? value("supportedInApi"),
      capabilities: {
        ...(Number.isFinite(Number(contextLength)) ? { contextWindow: Number(contextLength) } : {}),
        ...(Number.isFinite(Number(maxOutputTokens)) ? { maxOutput: Number(maxOutputTokens) } : {}),
        ...(supportsReasoning ? { reasoning: true, thinkingFormat: "openai" } : {}),
        ...(supportsTools === true ? { tools: true } : {}),
        ...(supportsSearch === true ? { search: true } : {}),
      },
    };

    models.push(model);
  }

  return models.length ? models : Object.values(GROK_CLI_MODELS);
}
