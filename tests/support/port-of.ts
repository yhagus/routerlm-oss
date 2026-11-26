import type { AddressInfo } from 'node:net';

export function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === 'string') {
    throw new Error('The server is not listening on a TCP port');
  }
  return address.port;
}
