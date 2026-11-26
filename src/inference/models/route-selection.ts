import type { Capability, ClientProtocol, UpstreamProtocol } from '@/db/schemas';
import {
  isUpstreamModelUsable,
  type SnapshotEndpoint,
  type SnapshotModel,
  type SnapshotProviderAccount,
  type SnapshotRoute,
  type SnapshotUpstreamModel,
} from '@/snapshot/models/snapshot';
import type { InferenceRequest } from './internal-format';
import { UPSTREAM_PROTOCOL_CONVERTERS } from '@/inference/protocols/converters';

const CHARACTERS_PER_TOKEN = 4;

export const UPSTREAM_PROTOCOL_SPOKEN_BY_CLIENT = {
  'openai-chat': 'openai-chat',
  'anthropic-messages': 'anthropic-messages',
  'openai-responses': 'openai-responses',
  'openai-images': undefined,
  'openai-videos': undefined,
  'openai-speech': undefined,
  'openai-transcription': undefined,
} as const satisfies Record<ClientProtocol, UpstreamProtocol | undefined>;

export function requiredCapabilities(request: InferenceRequest): Capability[] {
  const required: Capability[] = [];
  const hasImage = request.messages.some(
    (message) =>
      message.role !== 'assistant' && message.content.some((part) => part.type === 'image'),
  );
  if (hasImage) {
    required.push('vision');
  }
  if (request.tools.length > 0) {
    required.push('tools');
  }
  if (request.reasoning) {
    required.push('reasoning');
  }
  if (request.responseFormat?.type === 'json-schema') {
    required.push('structured-output');
  }
  return required;
}

export function capableRoutes(model: SnapshotModel, request: InferenceRequest): SnapshotRoute[] {
  return model.routes.filter((route) => route.isEnabled && canServe(route.upstreamModel, request));
}

export function endpointOf(
  { kind, protocols, provider }: SnapshotUpstreamModel,
  preferredProtocol?: UpstreamProtocol,
): SnapshotEndpoint | undefined {
  const chosen = protocols.find((protocol) => protocol === preferredProtocol) ?? protocols.at(0);
  if (chosen === undefined) {
    return provider.endpoints.find((endpoint) => endpoint.kind === kind);
  }
  return provider.endpoints.find((endpoint) => endpoint.protocol === chosen);
}

export function canServe(upstreamModel: SnapshotUpstreamModel, request: InferenceRequest): boolean {
  const endpoint = endpointOf(upstreamModel);
  const neededContext = estimatedPromptTokens(request) + (request.maxOutputTokens ?? 0);
  return (
    isUpstreamModelUsable(upstreamModel) &&
    endpoint !== undefined &&
    UPSTREAM_PROTOCOL_CONVERTERS[endpoint.protocol] !== undefined &&
    requiredCapabilities(request).every((capability) =>
      upstreamModel.capabilities.includes(capability),
    ) &&
    (upstreamModel.contextSize === null || neededContext <= upstreamModel.contextSize)
  );
}

export interface AttemptPath {
  route: SnapshotRoute | null;
  upstreamModel: SnapshotUpstreamModel;
}

export interface AttemptTarget extends AttemptPath {
  providerAccount: SnapshotProviderAccount;
}

export function routePath(route: SnapshotRoute): AttemptPath {
  return { route, upstreamModel: route.upstreamModel };
}

export function* attemptTargets(
  paths: AttemptPath[],
  isSkipped: (target: AttemptTarget) => boolean,
): Generator<AttemptTarget> {
  for (const path of paths) {
    for (const providerAccount of path.upstreamModel.provider.providerAccounts) {
      const target = { ...path, providerAccount };
      if (providerAccount.isEnabled && !isSkipped(target)) {
        yield target;
      }
    }
  }
}

function estimatedPromptTokens(request: InferenceRequest): number {
  let characters = request.system.reduce((sum, part) => sum + part.text.length, 0);
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type === 'text' || part.type === 'reasoning') {
        characters += part.text.length;
      } else if (part.type === 'tool-call') {
        characters += part.arguments.length;
      }
    }
  }
  return Math.floor(characters / CHARACTERS_PER_TOKEN);
}
