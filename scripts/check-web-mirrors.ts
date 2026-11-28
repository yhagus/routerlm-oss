import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  AUTH_STYLES,
  AUTO_PLAN_CHOICE,
  CAPABILITIES,
  CREDENTIAL_KINDS,
  MODEL_KINDS,
  NO_PLAN_CHOICE,
  OAUTH_LOGIN_FLOWS,
  OAUTH_REGIONS,
  PLAN_READERS,
  PROTOCOL_KINDS,
  QUOTA_READERS,
  UPSTREAM_PROTOCOLS,
} from '@/db/schemas/upstream';
import { MAX_REQUEST_RATE, MAX_SPEND_LIMIT_USD } from '@/api-keys/schemas/api-key.schema';
import { ERROR_ORIGINS, RECORDED_ATTEMPT_FAILURES } from '@/db/schemas/records';
import {
  CAPTURE_OUTCOMES,
  FAILED_HOPS,
} from '@/error-captures/schemas/error-capture-page-query.schema';
import { REASONING_EFFORTS, SERVICE_TIERS } from '@/inference/models/internal-format';
import { MAX_UPLOAD_BYTES } from '@/inference/models/media-upload';
import { WINDOW_PRICES_STATUSES } from '@/pricing-windows/models/pricing-window-activity';
import { AUDIO_FORMATS } from '@/inference/models/speech-synthesis';
import { VIDEO_RATIOS, VIDEO_RESOLUTIONS } from '@/inference/models/video-generation';
import { USAGE_STATUSES } from '@/usage/schemas/usage.schema';

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
  { name: 'PLAN_READERS', webFile: 'web/app/lib/upstream.ts', backend: PLAN_READERS },
  { name: 'QUOTA_READERS', webFile: 'web/app/lib/upstream.ts', backend: QUOTA_READERS },
  { name: 'CREDENTIAL_KINDS', webFile: 'web/app/lib/upstream.ts', backend: CREDENTIAL_KINDS },
  { name: 'OAUTH_REGIONS', webFile: 'web/app/lib/upstream.ts', backend: OAUTH_REGIONS },
  { name: 'OAUTH_LOGIN_FLOWS', webFile: 'web/app/lib/upstream.ts', backend: OAUTH_LOGIN_FLOWS },
  { name: 'AUTO_PLAN_CHOICE', webFile: 'web/app/lib/upstream.ts', backend: [AUTO_PLAN_CHOICE] },
  { name: 'NO_PLAN_CHOICE', webFile: 'web/app/lib/upstream.ts', backend: [NO_PLAN_CHOICE] },
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
    name: 'REASONING_EFFORTS',
    webFile: 'web/app/lib/parameterPolicy.ts',
    backend: REASONING_EFFORTS,
  },
  { name: 'SERVICE_TIERS', webFile: 'web/app/lib/parameterPolicy.ts', backend: SERVICE_TIERS },
  { name: 'USAGE_STATUSES', webFile: 'web/app/lib/usage.ts', backend: USAGE_STATUSES },
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

interface UncomparedNamesake {
  name: string;
  webFile: string;
  reason: string;
}

const UNCOMPARED_NAMESAKES: UncomparedNamesake[] = [
  {
    name: 'GROUP_SEPARATOR',
    webFile: 'web/app/lib/numberInput.ts',
    reason: 'groups digits in a number input; the backend one splits a Model Group from a model',
  },
  {
    name: 'OVERVIEW_RANGES',
    webFile: 'web/app/lib/overview.ts',
    reason: 'maps each range to its label, a shape the list comparison cannot read',
  },
  {
    name: 'POLICY_PARAMETERS',
    webFile: 'web/app/lib/parameterPolicy.ts',
    reason: 'describes each parameter for its form, a shape the list comparison cannot read',
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
const BACKEND_ROOT = 'src';
const EXPORTED_CONSTANT = /^export const ([A-Z][A-Z\d_]*)\b/gm;

function webEntriesOf(source: string, name: string): string[] | undefined {
  const declaration = new RegExp(`export const ${name}\\b[^=]*=\\s*([[{])`).exec(source);
  if (!declaration) return numericEntryOf(source, name) ?? stringEntryOf(source, name);
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

function stringEntryOf(source: string, name: string): string[] | undefined {
  const declaration = new RegExp(`export const ${name}\\b[^=]*=\\s*(["'])([^"']*)\\1;`).exec(
    source,
  );
  const value = declaration?.[2];
  return value === undefined ? undefined : [value];
}

interface ExportedConstant {
  file: string;
  name: string;
}

function typeScriptFilesIn(directory: string, options: { recursive: boolean }): string[] {
  return readdirSync(directory, { recursive: options.recursive, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `${directory}/${file}`);
}

function exportedConstantsIn(files: readonly string[]): ExportedConstant[] {
  return files.flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(EXPORTED_CONSTANT)].map((match) => ({
      file,
      name: match[1] ?? '',
    })),
  );
}

function isListedIn(
  entries: readonly { name: string; webFile: string }[],
  constant: ExportedConstant,
): boolean {
  return entries.some((entry) => entry.webFile === constant.file && entry.name === constant.name);
}

const problems: string[] = [];

const backendConstantNames = new Set(
  exportedConstantsIn(typeScriptFilesIn(BACKEND_ROOT, { recursive: true })).map(
    (constant) => constant.name,
  ),
);
const webNamesakes = exportedConstantsIn(typeScriptFilesIn(WEB_LIB, { recursive: false })).filter(
  (constant) => backendConstantNames.has(constant.name),
);
for (const namesake of webNamesakes) {
  if (isListedIn(MIRRORS, namesake) || isListedIn(UNCOMPARED_NAMESAKES, namesake)) continue;
  problems.push(
    `${namesake.file}: ${namesake.name} has the name of a backend constant but nothing compares them. ` +
      'Add it to MIRRORS in scripts/check-web-mirrors.ts, or to UNCOMPARED_NAMESAKES with the reason it is not a copy.',
  );
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
