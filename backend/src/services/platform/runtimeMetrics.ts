import { monitorEventLoopDelay } from "node:perf_hooks";

const RESOLUTION_MS = 10;
const NS_PER_MS = 1e6;

export interface SlowQueryCounter {
  thresholdMs: number | null;
  count(): number;
}

export interface RuntimeMetricsSnapshot {
  eventLoop: { p50Ms: number; p99Ms: number; maxMs: number; meanMs: number; samples: number; sinceMs: number };
  memory: { rssBytes: number; heapUsedBytes: number; peakRssBytes: number };
  slowQueries: { thresholdMs: number | null; count: number };
  uptimeSec: number;
}

export interface RuntimeMetrics {
  snapshot(): RuntimeMetricsSnapshot;
  // Clears the event-loop histogram so the next snapshot covers only new samples.
  reset(): void;
  stop(): void;
}

function ms(nanoseconds: number) {
  return Number.isFinite(nanoseconds) ? Math.round((nanoseconds / NS_PER_MS) * 100) / 100 : 0;
}

export function createRuntimeMetrics(slowQueries: SlowQueryCounter): RuntimeMetrics {
  const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram.enable();
  let since = Date.now();

  return {
    snapshot() {
      const memory = process.memoryUsage();
      const samples = histogram.count;
      return {
        eventLoop: {
          p50Ms: samples ? ms(histogram.percentile(50)) : 0,
          p99Ms: samples ? ms(histogram.percentile(99)) : 0,
          maxMs: samples ? ms(histogram.max) : 0,
          meanMs: samples ? ms(histogram.mean) : 0,
          samples,
          sinceMs: Date.now() - since,
        },
        memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024 },
        slowQueries: { thresholdMs: slowQueries.thresholdMs, count: slowQueries.count() },
        uptimeSec: Math.round(process.uptime()),
      };
    },
    reset() {
      histogram.reset();
      since = Date.now();
    },
    stop() {
      histogram.disable();
    },
  };
}
