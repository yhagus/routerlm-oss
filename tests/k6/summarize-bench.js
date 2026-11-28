import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const results = join(here, 'results');

const compose = Bun.YAML.parse(readFileSync(join(here, 'docker-compose.yml'), 'utf8'));

const MIB_PER_MEMORY_UNIT = { k: 1 / 1024, m: 1, g: 1024 };

function mebibytesOf(memLimit) {
  const match = /^(\d+(?:\.\d+)?)([kmg])$/i.exec(String(memLimit));
  if (!match) throw new Error(`Cannot read the Compose mem_limit "${memLimit}"`);
  return Number(match[1]) * MIB_PER_MEMORY_UNIT[match[2].toLowerCase()];
}

function limitsOf(serviceName) {
  const service = compose.services[serviceName];
  if (!service) throw new Error(`docker-compose.yml has no service ${serviceName}`);
  if (service.cpus === undefined || service.mem_limit === undefined) return undefined;
  return { cpuLimit: Number(service.cpus), memLimitMiB: mebibytesOf(service.mem_limit) };
}

function memoryText(mebibytes) {
  return mebibytes >= 1024 ? `${mebibytes / 1024} GB` : `${mebibytes} MB`;
}

function specText(limits) {
  if (!limits) return 'uncapped';
  return `${limits.cpuLimit} CPU / ${memoryText(limits.memLimitMiB)}`;
}

function node(label, containers, serviceName, note) {
  const limits = limitsOf(serviceName);
  const spec = note ? `${specText(limits)} (${note})` : specText(limits);
  return { label, containers, spec, ...limits };
}

function dualGateway() {
  const replica = limitsOf('backend-a');
  const replicas = ['backend-a', 'backend-b'].map(limitsOf);
  const total = {
    cpuLimit: replicas.reduce((sum, limits) => sum + limits.cpuLimit, 0),
    memLimitMiB: replicas.reduce((sum, limits) => sum + limits.memLimitMiB, 0),
  };
  const spec = `${specText(total)} (${replicas.length} replicas x ${specText(replica)})`;
  return { label: 'Gateway (app)', containers: /backend-[ab]-1/, spec, ...total };
}

const GATEWAY_BY_TOPOLOGY = {
  dual: dualGateway,
  single: () => node('Gateway (app)', /-backend-1/, 'backend', '1 process'),
  cluster: () =>
    node('Gateway (app)', /backend-cluster-1/, 'backend-cluster', '1 container, 2 processes'),
};
const gatewayOfTopology = GATEWAY_BY_TOPOLOGY[process.env.TOPOLOGY ?? 'dual'];
if (!gatewayOfTopology) throw new Error('TOPOLOGY must be dual, single or cluster');

const NODES = [
  gatewayOfTopology(),
  node('Worker', /worker-1/, 'worker'),
  node('PostgreSQL', /-db-1/, 'db'),
  node('Redis', /redis-1/, 'redis'),
  node('Fake upstream', /fake-upstream-1/, 'fake-upstream', 'test equipment'),
  node('Load balancer (nginx)', /-lb-1/, 'lb', 'test equipment'),
  node('k6 (load generator)', /k6-run/, 'k6', 'test equipment'),
];

const SCENARIOS = [
  {
    name: 'bench-raw',
    title: 'Scenario 1: Gateway -> Client',
    flow: 'k6 -> gateway -> instant fake upstream (no latency, 20 tokens)',
    load: (m) => `${m.vus_max.value} VUs, each sends its next request at once`,
  },
  {
    name: 'bench-mixed',
    title: 'Scenario 2: Upstream -> Gateway -> Client',
    flow: 'k6 -> gateway -> paced fake upstream (200 ms, then 100 tokens/s, 200 tokens)',
    load: (m) => `${m.vus_max.value} VUs, each sends its next request at once`,
  },
];

const MEM_UNITS = { B: 1 / 1048576, KiB: 1 / 1024, MiB: 1, GiB: 1024 };

function averages(statsPath) {
  const sums = new Map(NODES.map((node) => [node.label, { cpu: 0, mem: 0, samples: 0 }]));
  if (!existsSync(statsPath)) return sums;
  const blocks = readFileSync(statsPath, 'utf8').split(/^\d\d:\d\d:\d\d$/m);
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.includes(' cpu='));
    if (!lines.some((line) => /k6-run/.test(line))) continue;
    for (const node of NODES) {
      let cpu = 0;
      let mem = 0;
      let found = false;
      for (const line of lines) {
        if (!node.containers.test(line)) continue;
        const match = /cpu=([\d.]+)% mem=([\d.]+)(B|KiB|MiB|GiB)/.exec(line);
        if (!match) continue;
        found = true;
        cpu += Number(match[1]) / 100;
        mem += Number(match[2]) * MEM_UNITS[match[3]];
      }
      if (!found) continue;
      const sum = sums.get(node.label);
      sum.cpu += cpu;
      sum.mem += mem;
      sum.samples++;
    }
  }
  return sums;
}

const ms = (value) => (value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`);
const count = (value) => Math.round(value).toLocaleString('en-US');

function usageCell(value, limit, format) {
  if (value === undefined) return '-';
  if (!limit) return format(value);
  return `${format(value)} (${((value / limit) * 100).toFixed(0)}%)`;
}

function table(scenario) {
  const summaryPath = join(results, `${scenario.name}.json`);
  const rows = [['Item', 'Spec', 'Result', 'Avg CPU', 'Avg RAM']];
  if (!existsSync(summaryPath)) {
    rows.push(['Result', '', `no result: see results/${scenario.name}.out`, '', '']);
  } else {
    const { metrics } = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const requests = metrics.http_reqs.count;
    const seconds = requests / metrics.http_reqs.rate;
    const failed = metrics.http_req_failed.passes;
    const duration = metrics.http_req_duration;
    rows.push(
      ['Flow', '', scenario.flow, '', ''],
      ['Load', '', scenario.load(metrics), '', ''],
      ['Total time', '', `${seconds.toFixed(0)} s`, '', ''],
      ['Total requests', '', count(requests), '', ''],
      ['Requests per second', '', count(metrics.http_reqs.rate), '', ''],
      [
        'Failed requests',
        '',
        `${count(failed)} (${((failed / requests) * 100).toFixed(2)}%)`,
        '',
        '',
      ],
      ['Latency median / p95', '', `${ms(duration.med)} / ${ms(duration['p(95)'])}`, '', ''],
    );
    const averageByNode = averages(join(results, `${scenario.name}.stats.log`));
    for (const node of NODES) {
      const sum = averageByNode.get(node.label);
      const n = sum.samples;
      const cpu = n ? sum.cpu / n : undefined;
      const mem = n ? sum.mem / n : undefined;
      rows.push([
        node.label,
        node.spec,
        '',
        usageCell(cpu, node.cpuLimit, (value) => `${value.toFixed(2)} cores`),
        usageCell(mem, node.memLimitMiB, (value) => `${value.toFixed(0)} MiB`),
      ]);
    }
  }
  const [header, ...body] = rows;
  const line = (row) => `| ${row.join(' | ')} |`;
  return `### ${scenario.title}\n\n${[line(header), line(header.map(() => '---')), ...body.map(line)].join('\n')}`;
}

console.log(
  `\n${SCENARIOS.map(table).join('\n\n')}\n\nCPU is cores used (percent of the node's limit). RAM is MiB used (percent of limit). Both are averaged over samples taken about every 5 s while k6 ran.`,
);
