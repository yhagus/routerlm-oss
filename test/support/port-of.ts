import type { AddressInfo } from "node:net";

/** The TCP port a server listening on port 0 was given. */
export function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === "string") {
    throw new Error("The server is not listening on a TCP port");
  }
  return address.port;
}
