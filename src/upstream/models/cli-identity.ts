import { machine, release, type } from 'node:os';

const CLI_NAME = 'kimi-code-cli';
const CLI_PLATFORM = 'kimi_code_cli';
const DEVICE_NAME = 'routerlm';

export interface CliIdentity {
  cliVersion: string;
  deviceId: string;
}

export function cliIdentityHeaders({ cliVersion, deviceId }: CliIdentity): Record<string, string> {
  return {
    'user-agent': `${CLI_NAME}/${cliVersion}`,
    'x-msh-platform': CLI_PLATFORM,
    'x-msh-version': cliVersion,
    'x-msh-device-id': deviceId,
    'x-msh-device-name': DEVICE_NAME,
    'x-msh-device-model': `${type()} ${machine()}`,
    'x-msh-os-version': release(),
  };
}
