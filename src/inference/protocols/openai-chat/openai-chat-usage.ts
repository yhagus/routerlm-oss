import { z } from 'zod';
import type { StopReason, TokenUsage } from '@/inference/models/internal-format';

export const usageSchema = z.object({
  prompt_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
  prompt_tokens_details: z
    .object({
      cached_tokens: z.number().nullish(),
      cache_creation_input_tokens: z.number().nullish(),
    })
    .nullish(),
  completion_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish(),
  prompt_cache_hit_tokens: z.number().nullish(),
  cached_tokens: z.number().nullish(),
});
export type OpenAiUsage = z.infer<typeof usageSchema>;

export function tokenUsageOf(usage: OpenAiUsage | undefined): TokenUsage {
  const promptTokens = usage?.prompt_tokens ?? null;
  const cacheReadTokens =
    usage?.prompt_tokens_details?.cached_tokens ??
    usage?.cached_tokens ??
    usage?.prompt_cache_hit_tokens ??
    null;
  const cacheWriteTokens =
    usage === undefined ? null : (usage.prompt_tokens_details?.cache_creation_input_tokens ?? 0);
  return {
    inputTokens:
      promptTokens === null
        ? null
        : promptTokens - (cacheReadTokens ?? 0) - (cacheWriteTokens ?? 0),
    outputTokens: usage?.completion_tokens ?? null,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
  };
}

export function writeUsage(usage: TokenUsage): Record<string, unknown> {
  const cachedTokens = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const promptTokens = usage.inputTokens === null ? null : usage.inputTokens + cachedTokens;
  const written: Record<string, unknown> = {
    prompt_tokens: promptTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: (promptTokens ?? 0) + (usage.outputTokens ?? 0),
  };
  if (usage.cacheReadTokens !== null) {
    written.prompt_tokens_details = { cached_tokens: usage.cacheReadTokens };
  }
  if (usage.reasoningTokens !== null) {
    written.completion_tokens_details = { reasoning_tokens: usage.reasoningTokens };
  }
  return written;
}

export const openAiFinishReasonSchema = z.enum([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'function_call',
]);
type OpenAiFinishReason = z.infer<typeof openAiFinishReasonSchema>;

const STOP_REASONS = {
  stop: 'end',
  length: 'max-tokens',
  tool_calls: 'tool-calls',
  content_filter: 'content-filter',
  function_call: 'tool-calls',
} as const satisfies Record<OpenAiFinishReason, StopReason>;

export function stopReasonOf(finishReason: OpenAiFinishReason): StopReason {
  return STOP_REASONS[finishReason];
}

const FINISH_REASONS = {
  end: 'stop',
  'stop-sequence': 'stop',
  'max-tokens': 'length',
  'tool-calls': 'tool_calls',
  'content-filter': 'content_filter',
} as const satisfies Record<StopReason, OpenAiFinishReason>;

export function finishReasonOf(stopReason: StopReason): OpenAiFinishReason {
  return FINISH_REASONS[stopReason];
}
