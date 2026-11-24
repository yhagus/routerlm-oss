import { readFileSync } from "node:fs";
import { z } from "zod";

const PACKAGE_FILE = new URL("../../../package.json", import.meta.url);

export const GATEWAY_VERSION: string = z
  .object({ version: z.string().min(1) })
  .parse(JSON.parse(readFileSync(PACKAGE_FILE, "utf8"))).version;

export const GATEWAY_USER_AGENT = `routerlm/${GATEWAY_VERSION}`;
