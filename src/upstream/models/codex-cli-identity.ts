import { randomUUID } from 'node:crypto';
import { machine, release, type } from 'node:os';

const ORIGINATOR = 'codex_cli_rs';

export function codexCliHeaders(cliVersion: string): Record<string, string> {
  return {
    originator: ORIGINATOR,
    'user-agent': `${ORIGINATOR}/${cliVersion} (${type()} ${release()}; ${machine()})`,
  };
}

export interface CodexCliIdentity {
  cliVersion: string;
  accountId: string | null;
}

export function codexInferenceHeaders({
  cliVersion,
  accountId,
}: CodexCliIdentity): Record<string, string> {
  return {
    ...codexCliHeaders(cliVersion),
    version: cliVersion,
    'session-id': randomUUID(),
    ...(accountId === null ? {} : { 'chatgpt-account-id': accountId }),
  };
}
