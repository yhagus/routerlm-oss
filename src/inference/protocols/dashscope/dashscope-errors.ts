import type { AttemptFailureReason } from '@/db/schemas';
import { failureReasonOfStatus } from '@/inference/providers/upstream-client';

export function dashScopeFailureReasonOf(status: number, body: string): AttemptFailureReason {
  const code = errorCodeOf(body);
  if (code === 'InvalidApiKey') {
    return 'unauthorized';
  }
  if (code?.startsWith('Throttling')) {
    return 'rate_limited';
  }
  if (code === 'Arrearage') {
    return 'exhausted';
  }
  if (code === 'DataInspectionFailed') {
    return 'bad_request';
  }
  return failureReasonOfStatus(status);
}

function errorCodeOf(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'code' in parsed) {
      return typeof parsed.code === 'string' ? parsed.code : undefined;
    }
  } catch {}
  return undefined;
}
