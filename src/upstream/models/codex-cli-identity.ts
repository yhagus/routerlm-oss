import { randomUUID } from "node:crypto";
import { machine, release, type } from "node:os";

/** What the Codex CLI names itself as (ADR 0013). */
const ORIGINATOR = "codex_cli_rs";

/**
 * The headers with which the gateway presents itself as the Codex CLI on
 * calls to OpenAI's auth host.
 */
export function codexCliHeaders(cliVersion: string): Record<string, string> {
  return {
    originator: ORIGINATOR,
    // The gateway's own host, as the CLI describes the machine it runs on.
    "user-agent": `${ORIGINATOR}/${cliVersion} (${type()} ${release()}; ${machine()})`,
  };
}

/** Which Codex CLI release the gateway presents, and the ChatGPT account it calls for. */
export interface CodexCliIdentity {
  cliVersion: string;
  accountId: string | null;
}

/**
 * The headers an OpenAI Codex OAuth Login sends on inference and quota
 * calls, besides `Authorization`: the CLI's identity, its account, and a
 * session id of its own for each call, as a fresh CLI session would send.
 */
export function codexInferenceHeaders({
  cliVersion,
  accountId,
}: CodexCliIdentity): Record<string, string> {
  return {
    ...codexCliHeaders(cliVersion),
    version: cliVersion,
    "session-id": randomUUID(),
    ...(accountId === null ? {} : { "chatgpt-account-id": accountId }),
  };
}
