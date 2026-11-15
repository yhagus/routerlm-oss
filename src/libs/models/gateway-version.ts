import { readFileSync } from "node:fs";
import { z } from "zod";

// The package file sits three folders up from this one, in `src/` and in the build alike.
const PACKAGE_FILE = new URL("../../../package.json", import.meta.url);

/** The gateway's own version, as `package.json` states it. */
export const GATEWAY_VERSION: string = z
  .object({ version: z.string().min(1) })
  .parse(JSON.parse(readFileSync(PACKAGE_FILE, "utf8"))).version;

/** How the gateway names itself to an upstream: Providers ask third-party tools for their real User-Agent. */
export const GATEWAY_USER_AGENT = `routerlm/${GATEWAY_VERSION}`;
