// Fails when a list the dashboard (web/) copies from the backend has drifted
// from the backend's own. web/ is a separate app and can't import src/, so it
// keeps hand-written copies; this check is what keeps them honest. Run by
// `bun run check` at the root and in web/. To mirror another list, add it to
// MIRRORS below.
//
// A web constant whose doc comment says it copies "the backend's `NAME`" must
// have a MIRRORS entry: the check fails on a marked copy nobody compares.
//
// TYPE_MIRRORS does the same for response types: a web interface copied from a
// backend one must have the same field names, inherited ones included.
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  AUTH_STYLES,
  CAPABILITIES,
  MODEL_KINDS,
  PROTOCOL_KINDS,
  UPSTREAM_PROTOCOLS,
} from '@/db/schemas/upstream';
import { MAX_REQUEST_RATE, MAX_SPEND_LIMIT_USD } from '@/api-keys/schemas/api-key.schema';
import { ERROR_ORIGINS, RECORDED_ATTEMPT_FAILURES } from '@/db/schemas/records';
import {
  CAPTURE_OUTCOMES,
  FAILED_HOPS,
} from '@/error-captures/schemas/error-capture-page-query.schema';
import { MAX_UPLOAD_BYTES } from '@/inference/models/media-upload';
import { WINDOW_PRICES_STATUSES } from '@/pricing-windows/models/pricing-window-activity';
import { AUDIO_FORMATS } from '@/inference/models/speech-synthesis';
import { VIDEO_RATIOS, VIDEO_RESOLUTIONS } from '@/inference/models/video-generation';

interface Mirror {
  name: string;
  backendName?: string;
  webFile: string;
  backend: readonly string[];
}

const MIRRORS: Mirror[] = [
  { name: 'UPSTREAM_PROTOCOLS', webFile: 'web/app/lib/upstream.ts', backend: UPSTREAM_PROTOCOLS },
  { name: 'MODEL_KINDS', webFile: 'web/app/lib/upstream.ts', backend: MODEL_KINDS },
  { name: 'AUTH_STYLES', webFile: 'web/app/lib/upstream.ts', backend: AUTH_STYLES },
  { name: 'CAPABILITIES', webFile: 'web/app/lib/upstream.ts', backend: CAPABILITIES },
  {
    name: 'PROTOCOL_KINDS',
    webFile: 'web/app/lib/upstream.ts',
    backend: Object.entries(PROTOCOL_KINDS).map(([protocol, kind]) => `${protocol}=${kind}`),
  },
  { name: 'ERROR_ORIGINS', webFile: 'web/app/lib/errorOrigins.ts', backend: ERROR_ORIGINS },
  {
    name: 'RECORDED_ATTEMPT_FAILURES',
    webFile: 'web/app/lib/attemptFailures.ts',
    backend: RECORDED_ATTEMPT_FAILURES,
  },
  { name: 'FAILED_HOPS', webFile: 'web/app/lib/errorCaptures.ts', backend: FAILED_HOPS },
  { name: 'CAPTURE_OUTCOMES', webFile: 'web/app/lib/errorCaptures.ts', backend: CAPTURE_OUTCOMES },
  {
    name: 'WINDOW_PRICES_STATUSES',
    webFile: 'web/app/lib/pricingWindows.ts',
    backend: WINDOW_PRICES_STATUSES,
  },
  { name: 'AUDIO_FORMATS', webFile: 'web/app/lib/playgroundSpeech.ts', backend: AUDIO_FORMATS },
  {
    name: 'VIDEO_RESOLUTIONS',
    webFile: 'web/app/lib/playgroundVideo.ts',
    backend: VIDEO_RESOLUTIONS,
  },
  { name: 'VIDEO_RATIOS', webFile: 'web/app/lib/playgroundVideo.ts', backend: VIDEO_RATIOS },
  {
    name: 'MAX_AUDIO_BYTES',
    backendName: 'MAX_UPLOAD_BYTES',
    webFile: 'web/app/lib/playgroundTranscription.ts',
    backend: [String(MAX_UPLOAD_BYTES)],
  },
  {
    name: 'MAX_SPEND_LIMIT_USD',
    webFile: 'web/app/lib/api-keys.ts',
    backend: [String(MAX_SPEND_LIMIT_USD)],
  },
  {
    name: 'MAX_REQUEST_RATE',
    webFile: 'web/app/lib/api-keys.ts',
    backend: [String(MAX_REQUEST_RATE)],
  },
];

interface TypeMirror {
  name: string;
  webFile: string;
  backendName?: string;
  backendFile: string;
}

const TYPE_MIRRORS: TypeMirror[] = [
  ...['UsageLogSummary', 'UsageLogAttempt', 'UsageLogDetail', 'UsageLogPage', 'UsageSummary'].map(
    (name) => ({ name, webFile: 'web/app/lib/usage.ts', backendFile: 'src/usage/models/usage.ts' }),
  ),
  {
    name: 'IntegrationModel',
    webFile: 'web/app/lib/integrations.ts',
    backendName: 'ModelJson',
    backendFile: 'src/control-plane/models/proto-json.ts',
  },
];

function fieldNamesOf(mirrors: readonly TypeMirror[]): Map<string, string[] | undefined> {
  const files = mirrors.flatMap((mirror) => [mirror.webFile, mirror.backendFile]);
  const program = ts.createProgram([...new Set(files)], {
    noEmit: true,
    strict: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: '.',
    paths: { '~/*': ['web/app/*'], '@/*': ['src/*'] },
  });
  const checker = program.getTypeChecker();
  const fields = new Map<string, string[] | undefined>();
  for (const mirror of mirrors) {
    for (const [file, name] of [
      [mirror.webFile, mirror.name],
      [mirror.backendFile, mirror.backendName ?? mirror.name],
    ] as const) {
      const declaration = program
        .getSourceFile(file)
        ?.statements.find(
          (statement): statement is ts.InterfaceDeclaration =>
            ts.isInterfaceDeclaration(statement) && statement.name.text === name,
        );
      fields.set(
        `${file}#${name}`,
        declaration &&
          checker
            .getPropertiesOfType(checker.getTypeAtLocation(declaration.name))
            .map((property) => property.name),
      );
    }
  }
  return fields;
}

const WEB_LIB = 'web/app/lib';

function webEntriesOf(source: string, name: string): string[] | undefined {
  const declaration = new RegExp(`export const ${name}\\b[^=]*=\\s*([[{])`).exec(source);
  if (!declaration) return numericEntryOf(source, name);
  const opener = declaration[1];
  const closer = opener === '[' ? ']' : '}';
  const start = declaration.index + declaration[0].length;
  const rest = source.slice(start).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const body = rest.slice(0, rest.indexOf(closer));
  if (opener === '[') {
    return [...body.matchAll(/["']([^"']+)["']/g)].map((match) => match[1] ?? '');
  }
  return [...body.matchAll(/["']?([\w-]+)["']?\s*:\s*["']([^"']+)["']/g)].map(
    (match) => `${match[1]}=${match[2]}`,
  );
}

function numericEntryOf(source: string, name: string): string[] | undefined {
  const declaration = new RegExp(`export const ${name}\\b[^=]*=\\s*([\\d_\\s*+]+);`).exec(source);
  const expression = declaration?.[1];
  if (expression === undefined) return undefined;
  const sum = expression
    .split('+')
    .map((term) =>
      term.split('*').reduce((product, factor) => product * Number(factor.replaceAll('_', '')), 1),
    )
    .reduce((total, term) => total + term, 0);
  return [String(sum)];
}

/** `file: NAME` for each web constant marked as a copy of "the backend's `X`". */
function markedCopiesIn(directory: string): { webFile: string; name: string }[] {
  const marked =
    /\/\*\*(?:(?!\*\/)[\s\S])*the backend's `\w+`(?:(?!\*\/)[\s\S])*\*\/\s*export const (\w+)/g;
  return readdirSync(directory)
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) => {
      const webFile = `${directory}/${file}`;
      return [...readFileSync(webFile, 'utf8').matchAll(marked)].map((match) => ({
        webFile,
        name: match[1] ?? '',
      }));
    });
}

const problems: string[] = [];
for (const copy of markedCopiesIn(WEB_LIB)) {
  const mirrored = MIRRORS.some(
    (mirror) => mirror.webFile === copy.webFile && mirror.name === copy.name,
  );
  if (!mirrored) {
    problems.push(
      `${copy.webFile}: ${copy.name} is marked as a copy of the backend but has no MIRRORS entry in scripts/check-web-mirrors.ts.`,
    );
  }
}
for (const mirror of MIRRORS) {
  const web = webEntriesOf(readFileSync(mirror.webFile, 'utf8'), mirror.name);
  if (!web) {
    problems.push(`${mirror.webFile}: no \`export const ${mirror.name}\` found.`);
    continue;
  }
  const missing = mirror.backend.filter((entry) => !web.includes(entry));
  const extra = web.filter((entry) => !mirror.backend.includes(entry));
  if (missing.length > 0 || extra.length > 0) {
    problems.push(
      `${mirror.webFile}: ${mirror.name} differs from the backend's ${mirror.backendName ?? mirror.name}.` +
        (missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : '') +
        (extra.length > 0 ? ` Not in the backend: ${extra.join(', ')}.` : ''),
    );
  }
}

const typeFields = fieldNamesOf(TYPE_MIRRORS);
for (const mirror of TYPE_MIRRORS) {
  const backendName = mirror.backendName ?? mirror.name;
  const web = typeFields.get(`${mirror.webFile}#${mirror.name}`);
  const backend = typeFields.get(`${mirror.backendFile}#${backendName}`);
  if (!web || !backend) {
    problems.push(
      `${web ? mirror.backendFile : mirror.webFile}: no \`interface ${web ? backendName : mirror.name}\` found.`,
    );
    continue;
  }
  const missing = backend.filter((field) => !web.includes(field));
  const extra = web.filter((field) => !backend.includes(field));
  if (missing.length > 0 || extra.length > 0) {
    problems.push(
      `${mirror.webFile}: ${mirror.name} has other fields than the backend's ${backendName} (${mirror.backendFile}).` +
        (missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : '') +
        (extra.length > 0 ? ` Not in the backend: ${extra.join(', ')}.` : ''),
    );
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `check-web-mirrors: ${MIRRORS.length} lists and ${TYPE_MIRRORS.length} types match the backend.`,
);
