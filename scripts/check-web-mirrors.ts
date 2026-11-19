// Fails when a list the dashboard (web/) copies from the backend has drifted
// from the backend's own. web/ is a separate app and can't import src/, so it
// keeps hand-written copies; this check is what keeps them honest. Run by
// `bun run check`. To mirror another list, add it to MIRRORS below.
import { readFileSync } from "node:fs";
import {
  AUTH_STYLES,
  CAPABILITIES,
  MODEL_KINDS,
  PROTOCOL_KINDS,
  UPSTREAM_PROTOCOLS,
} from "@/db/schemas/upstream.js";
import { AUDIO_FORMATS } from "@/inference/models/speech-synthesis.js";

interface Mirror {
  /** The exported constant's name, the same in both apps. */
  name: string;
  /** The web file that holds the copy, relative to the repo root. */
  webFile: string;
  /** The backend's list, flattened to `key` or `key=value` entries. */
  backend: readonly string[];
}

const MIRRORS: Mirror[] = [
  { name: "UPSTREAM_PROTOCOLS", webFile: "web/app/lib/upstream.ts", backend: UPSTREAM_PROTOCOLS },
  { name: "MODEL_KINDS", webFile: "web/app/lib/upstream.ts", backend: MODEL_KINDS },
  { name: "AUTH_STYLES", webFile: "web/app/lib/upstream.ts", backend: AUTH_STYLES },
  { name: "CAPABILITIES", webFile: "web/app/lib/upstream.ts", backend: CAPABILITIES },
  {
    name: "PROTOCOL_KINDS",
    webFile: "web/app/lib/upstream.ts",
    backend: Object.entries(PROTOCOL_KINDS).map(([protocol, kind]) => `${protocol}=${kind}`),
  },
  { name: "AUDIO_FORMATS", webFile: "web/app/lib/playgroundSpeech.ts", backend: AUDIO_FORMATS },
];

/**
 * The entries of `export const <name> = [...]` or `= {...}` in `source`: each
 * quoted string of an array, or `key=value` for each property of an object.
 */
function webEntriesOf(source: string, name: string): string[] | undefined {
  const declaration = new RegExp(`export const ${name}\\b[^=]*=\\s*([[{])`).exec(source);
  if (!declaration) return undefined;
  const opener = declaration[1];
  const closer = opener === "[" ? "]" : "}";
  const start = declaration.index + declaration[0].length;
  // Comments may hold quotes and brackets of their own, so drop them first.
  const rest = source.slice(start).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const body = rest.slice(0, rest.indexOf(closer));
  if (opener === "[") {
    return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
  }
  return [...body.matchAll(/"?([\w-]+)"?\s*:\s*"([^"]+)"/g)].map(
    (match) => `${match[1]}=${match[2]}`,
  );
}

const problems: string[] = [];
for (const mirror of MIRRORS) {
  const web = webEntriesOf(readFileSync(mirror.webFile, "utf8"), mirror.name);
  if (!web) {
    problems.push(`${mirror.webFile}: no \`export const ${mirror.name}\` found.`);
    continue;
  }
  const missing = mirror.backend.filter((entry) => !web.includes(entry));
  const extra = web.filter((entry) => !mirror.backend.includes(entry));
  if (missing.length > 0 || extra.length > 0) {
    problems.push(
      `${mirror.webFile}: ${mirror.name} differs from the backend.` +
        (missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "") +
        (extra.length > 0 ? ` Not in the backend: ${extra.join(", ")}.` : ""),
    );
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`check-web-mirrors: ${MIRRORS.length} lists match the backend.`);
