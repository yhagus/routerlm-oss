import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const results = join(dirname(fileURLToPath(import.meta.url)), 'results');
const [topology, ...steps] = process.argv.slice(2);

function peaks(statsPath) {
  const peak = { cpu: 0, mem: 0 };
  if (!existsSync(statsPath)) return peak;
  for (const line of readFileSync(statsPath, 'utf8').split('\n')) {
    const match = /(backend\S*) cpu=([\d.]+)% mem=([\d.]+)(MiB|GiB)/.exec(line);
    if (!match) continue;
    peak.cpu = Math.max(peak.cpu, Number(match[2]));
    peak.mem = Math.max(peak.mem, Number(match[3]) * (match[4] === 'GiB' ? 1024 : 1));
  }
  return peak;
}

const ms = (value) => (value === undefined ? '-' : `${Math.round(value)} ms`);
const rows = [];
for (const vus of steps) {
  const base = join(results, `step-${topology}-${vus}`);
  if (!existsSync(`${base}.json`)) {
    rows.push([vus, 'no result', '', '', '', '', '', '']);
    continue;
  }
  const { metrics } = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
  const status = (code) => metrics[`status_${code}`]?.count ?? 0;
  const requests = metrics.http_reqs.count;
  const failed = metrics.http_req_failed.passes;
  const duration = metrics.http_req_duration;
  const peak = peaks(`${base}.stats.log`);
  rows.push([
    vus,
    requests,
    `${metrics.http_reqs.rate.toFixed(0)}/s`,
    `${failed} (${((failed / requests) * 100).toFixed(2)}%)`,
    `200:${status(200)} 502:${status(502)} 504:${status(504)} none:${status(0)}`,
    ms(duration['p(95)']),
    `${peak.cpu.toFixed(0)}%`,
    `${peak.mem.toFixed(0)} MiB`,
  ]);
}
const header = [
  'VUs',
  'Requests',
  'Rate',
  'Failed',
  'Statuses',
  'p95',
  'Gateway CPU peak',
  'Gateway memory peak',
];
const table = [header, header.map(() => '---'), ...rows]
  .map((row) => `| ${row.join(' | ')} |`)
  .join('\n');
console.log(`\nTopology: ${topology}\n\n${table}`);
