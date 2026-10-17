<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-vue-next";
import ProviderLogo from "@/components/app/ProviderLogo.vue";
import { providerMeta } from "@/lib/providerMeta";

type TopologyProvider = {
  provider: string;
  name?: string | null;
  nodeName?: string | null;
};

type ActiveRequest = {
  provider?: string | null;
  model?: string | null;
  account?: string | null;
  count?: number;
};

type NodeState = "idle" | "active" | "last" | "error";

const props = withDefaults(
  defineProps<{
    providers?: TopologyProvider[];
    activeRequests?: ActiveRequest[];
    lastProvider?: string | null;
    errorProvider?: string | null;
    height?: number;
  }>(),
  {
    providers: () => [],
    activeRequests: () => [],
    lastProvider: "",
    errorProvider: "",
  },
);

const MIN_WIDTH = 800;
const MIN_HEIGHT = 420;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.5;

function normalize(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

const activeProviders = computed(
  () =>
    new Set(
      props.activeRequests
        .map((request) => normalize(request.provider))
        .filter(Boolean),
    ),
);
const lastProvider = computed(() => normalize(props.lastProvider));
const errorProvider = computed(() => normalize(props.errorProvider));

const providerRows = computed(() => {
  const seen = new Set<string>();
  return props.providers
    .map((provider) => {
      const id = String(provider.provider || "").trim();
      if (!id || seen.has(id)) return null;
      seen.add(id);

      const metadata = providerMeta(id);
      const label =
        metadata.name && metadata.name !== id
          ? metadata.name
          : provider.nodeName || provider.name || metadata.name || id;
      const key = normalize(id);
      let state: NodeState = "idle";
      if (activeProviders.value.has(key)) state = "active";
      else if (errorProvider.value === key) state = "error";
      else if (lastProvider.value === key) state = "last";

      return {
        id,
        label,
        color: metadata.color || "#6b7280",
        textIcon: metadata.textIcon || id.slice(0, 2).toUpperCase(),
        state,
      };
    })
    .filter(
      (provider): provider is NonNullable<typeof provider> => provider !== null,
    );
});

const nodeSize = computed(() => {
  const count = providerRows.value.length;
  if (count <= 2) return { size: 39 };
  if (count <= 4) return { size: 36 };
  if (count <= 7) return { size: 32 };
  if (count <= 10) return { size: 29 };
  return { size: 26 };
});

const topology = computed(() => {
  const count = providerRows.value.length;
  const nodeGap = 18;
  const radiusX =
    count <= 2
      ? 240
      : Math.max(
          240,
          ((nodeSize.value.size + nodeGap) * count) / (2 * Math.PI),
        );
  const width = Math.max(
    MIN_WIDTH,
    Math.ceil(radiusX * 2 + nodeSize.value.size + 100),
  );
  const radiusY = count <= 2 ? 150 : Math.max(170, radiusX * 0.55);
  const height = Math.max(MIN_HEIGHT, Math.ceil(radiusY * 2 + 130));
  const center = { x: width / 2, y: height / 2 };

  const providers = providerRows.value.map((provider, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    const x = center.x + radiusX * Math.cos(angle);
    const y = center.y + radiusY * Math.sin(angle);
    return {
      ...provider,
      x,
      y,
      left: `${(x / width) * 100}%`,
      top: `${(y / height) * 100}%`,
    };
  });

  return {
    width,
    height,
    center,
    providers,
    routerLeft: `${(center.x / width) * 100}%`,
    routerTop: `${(center.y / height) * 100}%`,
  };
});

const activeCount = computed(() => activeProviders.value.size);
const viewportRef = ref<HTMLElement | null>(null);
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const dragging = ref(false);
let dragStart: { x: number; y: number; panX: number; panY: number } | null =
  null;

const stageHeight = computed(() => {
  if (props.height !== undefined) return props.height;
  const count = providerRows.value.length;
  if (count === 0) return 180;
  if (count <= 2) return 220;
  if (count <= 4) return 260;
  if (count <= 7) return 300;
  if (count <= 10) return 360;
  return 420;
});

const sceneStyle = computed(() => ({
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
}));

function clampPan(nextPan: { x: number; y: number }, nextZoom = zoom.value) {
  const viewport = viewportRef.value;
  if (!viewport) return nextPan;
  const maxX = Math.max(
    80,
    viewport.clientWidth * Math.max(0.25, nextZoom - 0.7) * 0.85,
  );
  const maxY = Math.max(
    60,
    viewport.clientHeight * Math.max(0.25, nextZoom - 0.7) * 0.85,
  );
  return {
    x: Math.min(maxX, Math.max(-maxX, nextPan.x)),
    y: Math.min(maxY, Math.max(-maxY, nextPan.y)),
  };
}

function setZoom(nextZoom: number, point?: { x: number; y: number }) {
  const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  if (!point || !viewportRef.value) {
    zoom.value = bounded;
    pan.value = clampPan(pan.value, bounded);
    return;
  }

  const oldZoom = zoom.value;
  const ratio = bounded / oldZoom;
  const nextPan = {
    x: point.x - (point.x - pan.value.x) * ratio,
    y: point.y - (point.y - pan.value.y) * ratio,
  };
  zoom.value = bounded;
  pan.value = clampPan(nextPan, bounded);
}

function changeZoom(delta: number) {
  setZoom(zoom.value + delta);
}

function resetView() {
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
}

function startPan(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button"))
    return;
  dragging.value = true;
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    panX: pan.value.x,
    panY: pan.value.y,
  };
  if (
    viewportRef.value &&
    typeof viewportRef.value.setPointerCapture === "function"
  )
    viewportRef.value.setPointerCapture(event.pointerId);
}

function movePan(event: PointerEvent) {
  if (!dragging.value || !dragStart) return;
  pan.value = clampPan({
    x: dragStart.panX + event.clientX - dragStart.x,
    y: dragStart.panY + event.clientY - dragStart.y,
  });
}

function endPan(event: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  dragStart = null;
  if (
    viewportRef.value &&
    typeof viewportRef.value.hasPointerCapture === "function" &&
    viewportRef.value.hasPointerCapture(event.pointerId)
  )
    viewportRef.value.releasePointerCapture(event.pointerId);
}

function handleWheel(event: WheelEvent) {
  const viewport = viewportRef.value;
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  setZoom(zoom.value + (event.deltaY > 0 ? -0.1 : 0.1), {
    x: event.clientX - rect.left - rect.width / 2,
    y: event.clientY - rect.top - rect.height / 2,
  });
}

watch(
  () => providerRows.value.map((provider) => provider.id).join(","),
  resetView,
);

function edgePath(node: { x: number; y: number }) {
  const { center } = topology.value;
  const dx = node.x - center.x;
  const dy = node.y - center.y;
  return `M ${center.x} ${center.y} C ${center.x + dx * 0.42} ${center.y + dy * 0.42}, ${node.x - dx * 0.24} ${node.y - dy * 0.24}, ${node.x} ${node.y}`;
}

function nodeTitle(node: { label: string; id: string; state: NodeState }) {
  if (node.state === "active") return `${node.label}: active request`;
  if (node.state === "error") return `${node.label}: recent error`;
  if (node.state === "last") return `${node.label}: last request`;
  return `${node.label} (${node.id})`;
}
</script>

<template>
  <div
    class="provider-topology"
    :style="{ height: `${stageHeight}px` }"
    role="img"
    aria-label="Provider upstream topology"
  >
    <div
      ref="viewportRef"
      class="topology-viewport"
      :class="{ 'topology-viewport-dragging': dragging }"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="endPan"
      @pointercancel="endPan"
      @wheel.prevent="handleWheel"
    >
      <div
        v-if="topology.providers.length"
        class="topology-scene"
        :style="sceneStyle"
      >
        <svg
          class="topology-canvas"
          :viewBox="`0 0 ${topology.width} ${topology.height}`"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <filter
              id="provider-topology-glow"
              x="-40%"
              y="-40%"
              width="180%"
              height="180%"
            >
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g v-for="node in topology.providers" :key="`edge-${node.id}`">
            <path
              v-if="node.state !== 'active'"
              :d="edgePath(node)"
              class="topology-edge"
              :style="{ stroke: 'var(--border)' }"
            />
            <template v-else>
              <path
                :d="edgePath(node)"
                class="topology-edge topology-edge-halo"
                filter="url(#provider-topology-glow)"
              />
              <path
                :d="edgePath(node)"
                class="topology-edge topology-edge-plasma"
              />
              <path
                :d="edgePath(node)"
                class="topology-edge topology-edge-active"
              />
            </template>
          </g>
        </svg>

        <div
          class="topology-router"
          :class="{ 'topology-router-active': activeCount > 0 }"
          :style="{ left: topology.routerLeft, top: topology.routerTop }"
          title="LobakAI gateway"
        >
          <span class="topology-router-mark" aria-hidden="true"
            ><img src="/favicon.svg" alt="" class="size-full"
          /></span>
          <span>LobakAI</span>
          <span v-if="activeCount" class="topology-router-count">{{
            activeCount
          }}</span>
        </div>

        <div
          v-for="node in topology.providers"
          :key="node.id"
          class="topology-provider"
          :class="`topology-provider-${node.state}`"
          :style="{
            left: node.left,
            top: node.top,
            width: `${nodeSize.size}px`,
            minWidth: `${nodeSize.size}px`,
            height: `${nodeSize.size}px`,
            minHeight: `${nodeSize.size}px`,
            borderColor: node.state === 'idle' ? 'var(--border)' : node.color,
            boxShadow:
              node.state === 'idle' ? 'none' : `0 0 16px ${node.color}55`,
          }"
          :title="nodeTitle(node)"
          :aria-label="node.label"
        >
          <ProviderLogo
            :provider="node.id"
            :label="node.label"
            size="size-full"
          />
          <span
            v-if="node.state === 'active'"
            class="topology-provider-pulse"
            :style="{ backgroundColor: node.color }"
          />
        </div>
      </div>

      <div
        v-else
        class="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        No providers connected
      </div>
    </div>

    <div
      v-if="topology.providers.length"
      class="topology-controls"
      @pointerdown.stop
    >
      <button
        type="button"
        class="topology-control"
        aria-label="Zoom out"
        title="Zoom out"
        @click="changeZoom(-0.1)"
      >
        <ZoomOut class="size-3.5" />
      </button>
      <span class="topology-zoom-label">{{ Math.round(zoom * 100) }}%</span>
      <button
        type="button"
        class="topology-control"
        aria-label="Zoom in"
        title="Zoom in"
        @click="changeZoom(0.1)"
      >
        <ZoomIn class="size-3.5" />
      </button>
      <button
        type="button"
        class="topology-control"
        aria-label="Reset view"
        title="Reset view"
        @click="resetView"
      >
        <RotateCcw class="size-3.5" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.provider-topology {
  position: relative;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--muted) 18%, transparent);
}

.topology-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}

.topology-viewport-dragging {
  cursor: grabbing;
}

.topology-scene {
  position: absolute;
  inset: 0;
  transform-origin: center;
  will-change: transform;
}

.topology-canvas {
  position: absolute;
  inset: 0;
  height: 100%;
  width: 100%;
}

.topology-edge {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.35;
  vector-effect: non-scaling-stroke;
}

.topology-edge-halo {
  stroke: #22d3ee;
  stroke-width: 12;
  opacity: 0.28;
}

.topology-edge-plasma {
  stroke: #4ade80;
  stroke-width: 6;
  stroke-dasharray: 16 11;
  opacity: 0.85;
  animation: topology-edge-dash 0.18s linear infinite;
}

.topology-edge-active {
  stroke: #f8fafc;
  stroke-width: 2.5;
  stroke-dasharray: 9 7;
  opacity: 1;
  animation: topology-edge-dash 0.22s linear infinite;
}

.topology-router,
.topology-provider {
  position: absolute;
  z-index: 1;
  display: flex;
  align-items: center;
  transform: translate(-50%, -50%);
  border: 2px solid var(--primary);
  background: var(--card);
  color: var(--primary);
}

.topology-router {
  min-width: 135px;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 0.75rem;
  padding: 0.55rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 700;
  box-shadow: 0 5px 16px color-mix(in srgb, var(--primary) 18%, transparent);
}

.topology-router-mark {
  display: grid;
  height: 1.35rem;
  width: 1.35rem;
  place-items: center;
  border-radius: 0.45rem;
  background: var(--primary);
  color: var(--primary-foreground);
  font-size: 0.9rem;
  font-weight: 800;
}

.topology-router-active {
  border-color: #fde047;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--primary) 28%, transparent),
    color-mix(in srgb, #facc15 22%, transparent),
    color-mix(in srgb, #22d3ee 18%, transparent)
  );
  color: #fde047;
  animation: topology-router-pulse 0.75s ease-in-out infinite;
}

.topology-router-count {
  min-width: 1.35rem;
  border-radius: 999px;
  background: #facc15;
  padding: 0.15rem 0.35rem;
  text-align: center;
  font-size: 0.7rem;
  color: #171514;
  box-shadow: 0 0 10px #fde047;
}

.topology-provider {
  overflow: hidden;
  justify-content: center;
  border-radius: 0.5rem;
  padding: 0;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.topology-provider-pulse {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  display: block;
  height: 0.5rem;
  width: 0.5rem;
  flex: 0 0 auto;
  border-radius: 999px;
  animation: topology-provider-ping 1s ease-out infinite;
}

.topology-controls {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 0.15rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--card) 90%, transparent);
  padding: 0.2rem;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--foreground) 10%, transparent);
  backdrop-filter: blur(8px);
}

.topology-control {
  display: grid;
  height: 1.7rem;
  width: 1.7rem;
  place-items: center;
  border-radius: 0.35rem;
  color: var(--muted-foreground);
}

.topology-control:hover,
.topology-control:focus-visible {
  background: var(--muted);
  color: var(--foreground);
  outline: none;
}

.topology-zoom-label {
  min-width: 2.5rem;
  text-align: center;
  font-size: 0.65rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
}

@keyframes topology-edge-dash {
  to {
    stroke-dashoffset: -36;
  }
}

@keyframes topology-provider-ping {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 currentColor;
  }
  50% {
    opacity: 0.7;
    box-shadow: 0 0 0 5px transparent;
  }
}

@keyframes topology-router-pulse {
  0%,
  100% {
    transform: translate(-50%, -50%) scale(1);
    box-shadow:
      0 0 10px #fde047,
      0 0 24px color-mix(in srgb, var(--primary) 60%, transparent);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.05);
    box-shadow:
      0 0 18px #fef08a,
      0 0 38px color-mix(in srgb, #22d3ee 55%, transparent);
  }
}

@media (max-width: 639px) {
  .topology-router {
    min-width: 125px;
    padding: 0.5rem 0.6rem;
  }
}
</style>
