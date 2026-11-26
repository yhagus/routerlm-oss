import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const STATUSES = ['accepted', 'superseded', 'deprecated'] as const;
export type Status = (typeof STATUSES)[number];

export const EXTRA_AREAS = ['app', 'backend', 'web', 'tests', 'tooling'] as const;

export interface Adr {
  number: string;
  file: string;
  title: string;
  status: Status;
  supersededBy?: string;
  areas: string[];
}

export interface AdrProblem {
  file: string;
  message: string;
}

const ADR_FILE = /^(\d{4})-.+\.md$/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

export function adrDir(root: string): string {
  return join(root, 'docs', 'adr');
}

export function knownAreas(root: string): string[] {
  const modules = readdirSync(join(root, 'src'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return [...modules, ...EXTRA_AREAS].toSorted();
}

function isStatus(value: string): value is Status {
  return STATUSES.some((status) => status === value);
}

function parseFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    const match = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) fields.set(match[1], match[2].trim());
  }
  return fields;
}

function parseList(value: string): string[] {
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function frontmatterExample(areas: string[]): string {
  return [
    'Start the ADR with frontmatter like this:',
    '---',
    'status: accepted',
    'areas: [upstream, routing]',
    '---',
    'status is one of: ' + STATUSES.join(', ') + ' (superseded also needs superseded-by: NNNN).',
    'areas are the parts of the code the decision governs: ' + areas.join(', ') + '.',
  ].join('\n');
}

function parseAdr(dir: string, file: string, number: string, areas: Set<string>): Adr | AdrProblem {
  const text = readFileSync(join(dir, file), 'utf8');
  const frontmatter = FRONTMATTER.exec(text);
  if (frontmatter?.[1] === undefined) return { file, message: 'has no frontmatter' };
  const fields = parseFields(frontmatter[1]);
  const status = fields.get('status') ?? '';
  if (!isStatus(status)) return { file, message: `has an unknown status "${status}"` };
  const supersededBy = fields.get('superseded-by');
  if (status === 'superseded' && (supersededBy === undefined || !/^\d{4}$/.test(supersededBy))) {
    return { file, message: 'is superseded but has no superseded-by: NNNN' };
  }
  const adrAreas = parseList(fields.get('areas') ?? '');
  if (adrAreas.length === 0) return { file, message: 'lists no areas' };
  const unknown = adrAreas.filter((area) => !areas.has(area));
  if (unknown.length > 0) return { file, message: `lists unknown areas: ${unknown.join(', ')}` };
  const title = /^# (.+)$/m.exec(text.slice(frontmatter[0].length))?.[1]?.trim();
  if (title === undefined) return { file, message: 'has no "# Title" line after its frontmatter' };
  return { number, file, title, status, supersededBy, areas: adrAreas };
}

export function readAdrs(root: string): { adrs: Adr[]; problems: AdrProblem[] } {
  const dir = adrDir(root);
  const areas = new Set(knownAreas(root));
  const adrs: Adr[] = [];
  const problems: AdrProblem[] = [];
  if (!existsSync(dir)) return { adrs, problems };
  for (const file of readdirSync(dir).toSorted()) {
    const number = ADR_FILE.exec(file)?.[1];
    if (number === undefined) continue;
    const parsed = parseAdr(dir, file, number, areas);
    if ('message' in parsed) problems.push(parsed);
    else adrs.push(parsed);
  }
  return { adrs, problems };
}

export function areasForPath(relativePath: string, areas: Set<string>): string[] {
  const [top, second] = relativePath.split('/');
  if (top === 'src') {
    if (second === undefined) return [];
    if (relativePath.split('/').length === 2) return ['app', 'backend'];
    return areas.has(second) ? [second, 'backend'] : ['backend'];
  }
  if (top === 'tests') {
    return second !== undefined && areas.has(second) && second !== 'tests'
      ? ['tests', second]
      : ['tests'];
  }
  if (top === 'web') return ['web'];
  if (top === 'scripts' || top === '.github') return ['tooling'];
  if (top !== undefined && !relativePath.includes('/') && !top.endsWith('.md')) return ['tooling'];
  return [];
}
