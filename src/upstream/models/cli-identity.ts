import { machine, release, type } from "node:os";

const CLI_NAME = "kimi-code-cli";
const CLI_PLATFORM = "kimi_code_cli";
/** What the Provider lists this gateway as among the User's signed-in devices. */
const DEVICE_NAME = "routerlm";

/** Which CLI release the gateway presents, and the device id of the OAuth Login it presents it for. */
export interface CliIdentity {
  cliVersion: string;
  deviceId: string;
}

/**
 * The headers with which an OAuth Login presents itself as the Provider's
 * official CLI (ADR 0012): the Provider offers sign-in to no other client.
 * They go on calls to the auth host and on inference calls, and never on
 * calls made with an API key.
 */
export function cliIdentityHeaders({ cliVersion, deviceId }: CliIdentity): Record<string, string> {
  return {
    "user-agent": `${CLI_NAME}/${cliVersion}`,
    "x-msh-platform": CLI_PLATFORM,
    "x-msh-version": cliVersion,
    "x-msh-device-id": deviceId,
    "x-msh-device-name": DEVICE_NAME,
    // The gateway's own host, as the CLI would describe the machine it runs on.
    "x-msh-device-model": `${type()} ${machine()}`,
    "x-msh-os-version": release(),
  };
}
