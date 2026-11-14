<script setup lang="ts">
import { computed, ref } from "vue";
import { compactNumber, fullNumber, percent, type BarRow, type Segment } from "~/lib/chart";
import {
  buildDailyTokens,
  buildTraffic,
  providerColor,
  providerSeries,
  rangeOptions,
  tokenSeries,
  type RangeKey,
} from "~/lib/dashboardData";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronRight,
  CircleCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  KeyRound,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  Network,
  Plus,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  TriangleAlert,
  X,
} from "@lucide/vue";

const theme = useTheme();
const themeIcon = computed(() =>
  theme.preference.value === "dark" ? Moon : theme.preference.value === "light" ? Sun : Monitor,
);

const toneIcon = (tone: string) => (tone === "warn" ? TriangleAlert : CircleCheck);

type View = "overview" | "providers" | "usage" | "keys";
const activeView = ref<View>("overview");
const mobileNavOpen = ref(false);
const range = ref<RangeKey>("24h");
const providerFilter = ref("All providers");
const query = ref("");
const toast = ref("");
let toastTimer: number | undefined;

const navigation = [
  { id: "overview" as View, label: "Dashboard", short: "01", icon: LayoutDashboard },
  { id: "providers" as View, label: "Providers", short: "02", icon: Network },
  { id: "usage" as View, label: "Usage", short: "03", icon: BarChart3 },
  { id: "keys" as View, label: "Access keys", short: "04", icon: KeyRound },
];

const providers = [
  {
    name: "OpenAI",
    models: "14 models",
    traffic: "42.8%",
    health: "99.99%",
    status: "Healthy",
    tone: "good",
  },
  {
    name: "Anthropic",
    models: "9 models",
    traffic: "28.4%",
    health: "99.97%",
    status: "Healthy",
    tone: "good",
  },
  {
    name: "Alibaba",
    models: "18 models",
    traffic: "17.1%",
    health: "99.94%",
    status: "Healthy",
    tone: "good",
  },
  {
    name: "CommandCode",
    models: "6 models",
    traffic: "8.3%",
    health: "98.72%",
    status: "Degraded",
    tone: "warn",
  },
];

const routes = [
  {
    name: "balanced-chat",
    chain: ["OpenAI", "Anthropic"],
    requests: "1,284,000,000",
    latency: "620 ms",
    status: "Healthy",
    tone: "good",
    note: "Main chat traffic",
  },
  {
    name: "fast-complete",
    chain: ["Alibaba", "OpenAI"],
    requests: "923,000,000",
    latency: "488 ms",
    status: "Healthy",
    tone: "good",
    note: "Fast completion traffic",
  },
  {
    name: "code-heavy",
    chain: ["CommandCode", "OpenCode Go"],
    requests: "632,000,000",
    latency: "1,420 ms",
    status: "Degraded",
    tone: "warn",
    note: "Fallback after first hop",
  },
];

const usageRows = [
  {
    provider: "OpenAI",
    requests: 1_210_000_000,
    input: 84_200_000_000_000,
    inputCached: 31_600_000_000_000,
    output: 26_400_000_000_000,
    outputCached: 4_800_000_000_000,
    latency: 612,
  },
  {
    provider: "Anthropic",
    requests: 806_000_000,
    input: 58_100_000_000_000,
    inputCached: 18_400_000_000_000,
    output: 19_700_000_000_000,
    outputCached: 3_100_000_000_000,
    latency: 714,
  },
  {
    provider: "Alibaba",
    requests: 486_000_000,
    input: 34_600_000_000_000,
    inputCached: 9_900_000_000_000,
    output: 11_200_000_000_000,
    outputCached: 1_600_000_000_000,
    latency: 488,
  },
  {
    provider: "CommandCode",
    requests: 236_000_000,
    input: 18_800_000_000_000,
    inputCached: 4_100_000_000_000,
    output: 6_700_000_000_000,
    outputCached: 900_000_000_000,
    latency: 1_420,
  },
];

const keys = [
  {
    label: "production-gateway",
    owner: "Platform team",
    scope: "All routes",
    lastUsed: "2 min ago",
    status: "Active",
    tone: "good",
  },
  {
    label: "staging-smoke-tests",
    owner: "QA automation",
    scope: "Read + test",
    lastUsed: "18 min ago",
    status: "Active",
    tone: "good",
  },
  {
    label: "legacy-cli",
    owner: "Unassigned",
    scope: "Read only",
    lastUsed: "Never",
    status: "Expiring",
    tone: "warn",
  },
];

const viewTitle = computed(
  () =>
    ({
      overview: "Dashboard",
      providers: "Providers",
      usage: "Usage",
      keys: "Access keys",
    })[activeView.value],
);

useHead({ title: viewTitle, titleTemplate: "%s · RouterLM" });
const filteredRoutes = computed(() =>
  routes.filter(
    (item) => !query.value || item.name.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const filteredProviders = computed(() =>
  providers.filter(
    (item) => !query.value || item.name.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const filteredKeys = computed(() =>
  keys.filter(
    (item) => !query.value || item.label.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const filteredUsageRows = computed(() =>
  usageRows.filter(
    (item) => providerFilter.value === "All providers" || item.provider === providerFilter.value,
  ),
);

// ---- Chart data ----
const rangeLabel = computed(
  () => rangeOptions.find((option) => option.value === range.value)?.label ?? "",
);
const bucketLabel = computed(
  () => ({ "24h": "per hour", "7d": "per 6 hours", "30d": "per day" })[range.value],
);
const traffic = computed(() => buildTraffic(range.value));
const trafficTitles = computed(() => traffic.value.points.map((point) => point.title));
const requestTotal = computed(() => traffic.value.totals.reduce((sum, value) => sum + value, 0));
const latencyNow = computed(() => traffic.value.latency.at(-1) ?? 0);
const cacheHitNow = computed(() => traffic.value.cacheHit.at(-1) ?? 0);
const formatMs = (value: number) => `${fullNumber(value)} ms`;
const formatTokens = (value: number) => `${fullNumber(value)} tokens`;

const trafficShare = computed<Segment[]>(() =>
  providerSeries.map((series, index) => ({
    key: series.key,
    name: series.name,
    color: series.color,
    value: traffic.value.points.reduce((sum, point) => sum + point.values[index]!, 0),
  })),
);

const monthTokens = {
  input: 195_700_000_000_000,
  inputCached: 64_000_000_000_000,
  output: 64_000_000_000_000,
  outputCached: 10_400_000_000_000,
};
const tokenComposition: Segment[] = [
  monthTokens.input - monthTokens.inputCached,
  monthTokens.inputCached,
  monthTokens.output - monthTokens.outputCached,
  monthTokens.outputCached,
].map((value, index) => ({ ...tokenSeries[index]!, value }));

const dailyTokens = buildDailyTokens();
const dailyTokenSeries = [
  { key: "input", name: "Input tokens", color: "var(--token-input)" },
  { key: "output", name: "Output / write tokens", color: "var(--token-output)" },
];

const usageBars = computed<BarRow[]>(() =>
  filteredUsageRows.value.map((row) => ({
    key: row.provider,
    label: row.provider,
    values: [row.input - row.inputCached, row.inputCached, row.output - row.outputCached, row.outputCached],
  })),
);
const latencyBars: BarRow[] = [...usageRows]
  .sort((a, b) => b.latency - a.latency)
  .map((row) => ({
    key: row.provider,
    label: row.provider,
    values: [row.latency],
    note: row.latency > 1000 ? "Above 1,000 ms" : undefined,
  }));
const latencySeries = [{ key: "p95", name: "p95 latency", color: "var(--chart-neutral)" }];

function selectView(view: View) {
  activeView.value = view;
  mobileNavOpen.value = false;
  query.value = "";
}
function showToast(message: string) {
  toast.value = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 2600);
}
function createItem(label: string) {
  showToast(`${label} started`);
}
</script>

<template>
  <div class="app-shell">
    <div v-if="mobileNavOpen" class="nav-scrim" @click="mobileNavOpen = false" />
    <aside class="sidebar" :class="{ 'sidebar--open': mobileNavOpen }">
      <div class="sidebar__brand">
        <div class="brand">
          <span class="brand__mark">R</span><span>router<span>lm</span></span>
        </div>
        <button
          class="icon-button sidebar__close"
          aria-label="Close navigation"
          @click="mobileNavOpen = false"
        >
          <X :size="18" />
        </button>
      </div>
      <nav class="sidebar__nav" aria-label="Primary navigation">
        <span class="nav-group-label">Gateway</span>
        <button
          v-for="item in navigation.slice(0, 3)"
          :key="item.id"
          class="nav-item"
          :class="{ 'nav-item--active': activeView === item.id }"
          @click="selectView(item.id)"
        >
          <component :is="item.icon" :size="17" :stroke-width="1.8" /><span>{{ item.label }}</span>
        </button>
        <span class="nav-group-label">Settings</span>
        <button class="nav-item" @click="showToast('Routing policies opened')">
          <SlidersHorizontal :size="17" /><span>Routing policies</span>
        </button>
        <button class="nav-item" @click="selectView('keys')">
          <KeyRound :size="17" /><span>Access & keys</span><span class="nav-item__badge">3</span>
        </button>
        <button class="nav-item" @click="showToast('Organization settings opened')">
          <Settings2 :size="17" /><span>Organization settings</span>
        </button>
      </nav>
      <div class="sidebar__footer">
        <button class="profile" @click="showToast('Profile menu opened')">
          <span class="profile__avatar">AM</span
          ><span><strong>Alex Morgan</strong><small>Org administrator</small></span
          ><ChevronDown :size="14" />
        </button>
      </div>
    </aside>
    <main class="main-content">
      <header class="topbar">
        <button
          class="icon-button mobile-menu"
          aria-label="Open navigation"
          @click="mobileNavOpen = true"
        >
          <Menu :size="20" />
        </button>
        <div class="breadcrumbs">
          <span>RouterLM Control Plane</span><span>/</span><strong>{{ viewTitle }}</strong>
        </div>
        <div class="topbar__actions">
          <label class="global-search"
            ><Search :size="15" /><input
              v-model="query"
              placeholder="Search routes, providers, keys"
              aria-label="Global search"
              @keydown.esc="query = ''" /></label
          ><button class="icon-button" aria-label="Help" @click="showToast('Help center opened')">
            <CircleHelp :size="18" /></button
          ><button
            class="icon-button notification"
            aria-label="Notifications"
            @click="showToast('No new notifications')"
          >
            <Bell :size="18" /><i />
          </button>
          <div class="topbar__divider" />
          <AppSelect
            class="topbar__theme-select"
            :model-value="theme.preference"
            aria-label="Color theme"
            :options="[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]"
            @update:model-value="theme.setPreference"
          >
            <template #leading><component :is="themeIcon" :size="15" :stroke-width="1.8" /></template>
          </AppSelect>
        </div>
      </header>
      <div class="page-wrap">
        <section class="page-heading">
          <div>
            <h1>{{ viewTitle }}</h1>
            <p class="page-heading__sub">
              Monitor routes, providers, and gateway traffic in one place.
            </p>
          </div>
          <div class="page-heading__controls">
            <AppSelect
              v-if="activeView === 'overview'"
              v-model="range"
              aria-label="Time range"
              :options="rangeOptions"
            >
              <template #leading><Clock3 :size="15" /></template>
            </AppSelect>
            <button
              class="button button--primary"
              @click="
                createItem(
                  activeView === 'keys'
                    ? 'Create API key'
                    : activeView === 'providers'
                      ? 'Add provider'
                      : activeView === 'overview'
                        ? 'Create route'
                        : 'Export data',
                )
              "
            >
              <Plus :size="16" />{{
                activeView === "keys"
                  ? "Create key"
                  : activeView === "providers"
                    ? "Add provider"
                    : activeView === "overview"
                      ? "Create route"
                      : "Export data"
              }}
            </button>
          </div>
        </section>
        <template v-if="activeView === 'overview'">
          <section class="executive-band">
            <div class="executive-band__lead">
              <span class="metric-label">Active routes</span><strong>12</strong>
              <p>4 providers · 3 healthy</p>
            </div>
            <div class="executive-band__stat">
              <span>Requests</span><strong class="tabular">{{ fullNumber(requestTotal) }}</strong>
              <ChartSparkline
                :values="traffic.totals"
                :labels="trafficTitles"
                :format-value="fullNumber"
                :label="`Requests ${bucketLabel}, ${rangeLabel.toLowerCase()}`"
              />
            </div>
            <div class="executive-band__stat">
              <span>p95 latency</span><strong class="tabular">{{ formatMs(latencyNow) }}</strong>
              <ChartSparkline
                :values="traffic.latency"
                :labels="trafficTitles"
                :format-value="formatMs"
                :label="`p95 latency ${bucketLabel}, ${rangeLabel.toLowerCase()}`"
              />
            </div>
            <div class="executive-band__stat">
              <span>Cache hit rate</span><strong class="tabular">{{ percent(cacheHitNow) }}</strong>
              <ChartSparkline
                :values="traffic.cacheHit"
                :labels="trafficTitles"
                :format-value="(value: number) => percent(value)"
                :label="`Cache hit rate ${bucketLabel}, ${rangeLabel.toLowerCase()}`"
              />
            </div>
          </section>
          <section class="dashboard-grid">
            <article class="panel panel--full">
              <div class="panel-heading">
                <div>
                  <h2>Request volume</h2>
                  <p>Requests {{ bucketLabel }} by provider, {{ rangeLabel.toLowerCase() }}.</p>
                </div>
                <div class="panel-heading__figure">
                  <strong>{{ compactNumber(requestTotal) }}</strong><span>requests in range</span>
                </div>
              </div>
              <div class="panel__body">
                <ChartArea
                  :series="providerSeries"
                  :points="traffic.points"
                  :label="`Requests ${bucketLabel} by provider, ${rangeLabel.toLowerCase()}`"
                  unit="requests"
                />
              </div>
            </article>
            <article class="panel panel--wide">
              <div class="panel-heading">
                <div>
                  <h2>Route performance</h2>
                  <p>Requests by route and provider chain.</p>
                </div>
                <div class="panel-heading__tools">
                  <label class="search-control"
                    ><Search :size="15" /><input
                      v-model="query"
                      placeholder="Filter routes"
                      aria-label="Filter routes" /></label
                  ><button
                    class="button button--quiet"
                    @click="showToast('Column settings opened')"
                  >
                    <SlidersHorizontal :size="15" />Columns
                  </button>
                </div>
              </div>
              <div class="route-table">
                <div class="route-table__head">
                  <span>Route</span><span>Provider chain</span><span>Requests</span><span>p95</span
                  ><span />
                </div>
                <div v-for="route in filteredRoutes" :key="route.name" class="route-table__row">
                  <div class="route-name">
                    <span class="route-icon"><Route :size="15" :stroke-width="1.8" /></span><span
                      ><strong>{{ route.name }}</strong><small>{{ route.note }}</small></span
                    >
                  </div>
                  <span class="route-chain"
                    ><template v-for="(hop, index) in route.chain" :key="hop"
                      ><ChevronRight v-if="index > 0" :size="13" class="route-chain__sep" /><span>{{
                        hop
                      }}</span></template
                    ></span
                  ><span class="tabular">{{ route.requests }}</span
                  ><span class="tabular">{{ route.latency }}</span
                  ><button class="row-action" @click="showToast(`Opened ${route.name}`)">
                    <ArrowUpRight :size="14" />
                  </button>
                </div>
              </div>
              <div v-if="filteredRoutes.length === 0" class="empty-state">
                <strong>No routes match.</strong
                ><span>Search by route name or clear the filter.</span>
                <button class="text-button" @click="query = ''">Clear filter</button>
              </div>
              <div class="panel-footer">
                <span>Showing 3 of 12 active routes</span
                ><button class="text-button" @click="selectView('providers')">
                  Manage routing <ArrowUpRight :size="14" />
                </button>
              </div>
            </article>
            <article class="panel panel--side">
              <div class="panel-heading">
                <div>
                  <h2>Availability</h2>
                  <p>Current health of connected providers.</p>
                </div>
                <button class="text-button" @click="selectView('providers')">
                  View all <ArrowUpRight :size="14" />
                </button>
              </div>
              <div class="provider-share">
                <ChartSegmentBar
                  :segments="trafficShare"
                  :legend="false"
                  :label="`Traffic share by provider, ${rangeLabel.toLowerCase()}`"
                />
              </div>
              <div class="provider-list">
                <div v-for="provider in providers" :key="provider.name" class="provider-row">
                  <span class="provider-logo"
                    ><i class="provider-dot" :style="{ background: providerColor(provider.name) }" /></span
                  ><span class="provider-row__name"
                    ><strong>{{ provider.name }}</strong
                    ><small>{{ provider.models }} · {{ provider.traffic }} share</small></span
                  ><span class="provider-row__health">{{ provider.health }}</span
                  ><span class="provider-row__bar"
                    ><i :style="{ width: provider.traffic, background: providerColor(provider.name) }"
                  /></span
                  ><span
                    class="status-badge status-badge--small"
                    :class="`status-badge--${provider.tone}`"
                    role="img"
                    :aria-label="provider.status"
                    ><component :is="toneIcon(provider.tone)" :size="15" :stroke-width="2"
                  /></span>
                </div>
              </div>
              <div class="provider-list__footer">
                <span class="legend legend--good"><CircleCheck :size="13" :stroke-width="2" />3 healthy</span
                ><span class="legend legend--warn"><TriangleAlert :size="13" :stroke-width="2" />1 degraded</span>
              </div>
            </article>
            <article class="panel panel--wide panel--activity">
              <div class="panel-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>Events from the last 24 hours.</p>
                </div>
                <button class="text-button" @click="showToast('Opened event timeline')">
                  Open timeline <ArrowUpRight :size="14" />
                </button>
              </div>
              <div class="activity-row">
                <span class="activity-time">14:24</span
                ><span class="activity-marker activity-marker--warn"><Activity :size="14" /></span
                ><span class="activity-copy"
                  ><strong>CommandCode latency is above threshold</strong
                  ><small>code-heavy is using the OpenCode Go fallback</small></span
                ><span class="activity-tag activity-tag--warn">Degraded</span>
              </div>
              <div class="activity-row">
                <span class="activity-time">13:51</span
                ><span class="activity-marker activity-marker--good"
                  ><ShieldCheck :size="14" /></span
                ><span class="activity-copy"
                  ><strong>Provider health check passed</strong
                  ><small>Anthropic latency is back within range</small></span
                ><span class="activity-tag">Resolved</span>
              </div>
            </article>
            <article class="panel panel--side panel--summary">
              <div class="summary-heading">
                <h2>Usage this month</h2>
              </div>
              <div class="summary-number">259,700,000,000,000 <span>tokens</span></div>
              <ChartSegmentBar
                class="summary-composition"
                :segments="tokenComposition"
                :format-value="compactNumber"
                label="Token composition this month"
              />
              <div class="summary-meta">
                <span>{{ fullNumber(monthTokens.input) }} input tokens</span
                ><span>{{ percent(monthTokens.inputCached / monthTokens.input) }} input cache ratio</span>
              </div>
              <dl class="summary-breakdown">
                <div>
                  <dt>Requests / min</dt>
                  <dd>18,640</dd>
                </div>
                <div>
                  <dt>In-flight requests</dt>
                  <dd>42</dd>
                </div>
              </dl>
              <button class="text-button" @click="selectView('usage')">
                View usage details <ArrowUpRight :size="14" />
              </button>
            </article>
          </section>
        </template>
        <template v-else-if="activeView === 'providers'">
          <section class="chart-row">
            <article class="panel">
              <div class="panel-heading">
                <div>
                  <h2>Traffic share</h2>
                  <p>Requests by provider, last 24 hours.</p>
                </div>
              </div>
              <div class="panel__body">
                <ChartSegmentBar :segments="trafficShare" label="Traffic share by provider, last 24 hours" />
              </div>
            </article>
            <article class="panel">
              <div class="panel-heading">
                <div>
                  <h2>p95 latency</h2>
                  <p>Slowest provider first, this month.</p>
                </div>
              </div>
              <div class="panel__body">
                <ChartBarList
                  :rows="latencyBars"
                  :series="latencySeries"
                  :format-value="formatMs"
                  label="p95 latency by provider"
                />
              </div>
            </article>
          </section>
          <section class="section-intro">
            <div>
              <h2>Connected providers</h2>
              <p>Connection health, model coverage, and traffic share by provider.</p>
            </div>
            <label class="search-control"
              ><Search :size="15" /><input
                v-model="query"
                placeholder="Search providers"
                aria-label="Search providers"
            /></label>
          </section>
          <section class="panel table-panel">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Models</th>
                    <th>Traffic share</th>
                    <th>Availability</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="provider in filteredProviders" :key="provider.name">
                    <td>
                      <div class="table-entity">
                        <span class="provider-logo"
                          ><i class="provider-dot" :style="{ background: providerColor(provider.name) }" /></span
                        ><strong>{{ provider.name }}</strong>
                      </div>
                    </td>
                    <td>{{ provider.models }}</td>
                    <td class="tabular">{{ provider.traffic }}</td>
                    <td class="tabular">{{ provider.health }}</td>
                    <td>
                      <span class="status-badge" :class="`status-badge--${provider.tone}`"
                        ><component :is="toneIcon(provider.tone)" :size="13" :stroke-width="2" />{{ provider.status }}</span
                      >
                    </td>
                    <td>
                      <button class="row-action" @click="showToast(`Opened ${provider.name}`)">
                        Manage <ArrowUpRight :size="14" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="filteredProviders.length === 0" class="empty-state">
                <strong>No providers match.</strong
                ><span>Search by provider name or clear the filter.</span>
                <button class="text-button" @click="query = ''">Clear filter</button>
              </div>
            </div>
          </section>
        </template>
        <template v-else-if="activeView === 'usage'">
          <section class="executive-band executive-band--usage">
            <div class="executive-band__lead">
              <span class="metric-label">Usage this month</span><strong>259,700,000,000,000</strong
              ><span class="trend trend--up"><ArrowUp :size="12" :stroke-width="2.2" />9.4%</span>
              <p>Total input and output tokens across all providers</p>
            </div>
            <div class="executive-band__stat">
              <span>Input tokens</span><strong>195,700,000,000,000</strong>
            </div>
            <div class="executive-band__stat">
              <span>Cached input</span><strong>64,000,000,000,000</strong>
            </div>
            <div class="executive-band__stat">
              <span>Output / write</span><strong>64,000,000,000,000</strong>
            </div>
            <div class="executive-band__stat">
              <span>Cached output / write</span><strong>10,400,000,000,000</strong>
            </div>
            <div class="executive-band__stat">
              <span>Requests / min</span><strong>18,640</strong>
            </div>
            <div class="executive-band__stat">
              <span>In-flight requests</span><strong>42</strong>
            </div>
          </section>
          <section class="chart-row chart-row--single">
            <article class="panel">
              <div class="panel-heading">
                <div>
                  <h2>Daily tokens</h2>
                  <p>Input and output / write tokens per day, last 30 days.</p>
                </div>
              </div>
              <div class="panel__body">
                <ChartArea
                  :series="dailyTokenSeries"
                  :points="dailyTokens"
                  :stacked="false"
                  :format-value="formatTokens"
                  label="Daily input and output tokens, last 30 days"
                />
              </div>
            </article>
          </section>
          <section class="section-intro">
            <div>
              <h2>Tokens by provider</h2>
              <p>Input, cached input, output / write, and cached output / write this month.</p>
            </div>
            <AppSelect
              v-model="providerFilter"
              aria-label="Provider filter"
              :options="[
                { label: 'All providers', value: 'All providers' },
                { label: 'OpenAI', value: 'OpenAI' },
                { label: 'Anthropic', value: 'Anthropic' },
                { label: 'Alibaba', value: 'Alibaba' },
                { label: 'CommandCode', value: 'CommandCode' },
              ]"
            />
          </section>
          <section v-if="usageBars.length" class="panel chart-panel">
            <div class="panel__body panel__body--top">
              <ChartBarList
                :rows="usageBars"
                :series="tokenSeries"
                :format-value="formatTokens"
                :format-total="compactNumber"
                label="Token mix by provider this month"
              />
            </div>
          </section>
          <section class="panel table-panel">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Requests</th>
                    <th>Input tokens</th>
                    <th>Cached input</th>
                    <th>Output / write</th>
                    <th>Cached output / write</th>
                    <th>p95 latency</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in filteredUsageRows" :key="row.provider">
                    <td><strong>{{ row.provider }}</strong></td>
                    <td class="tabular">{{ fullNumber(row.requests) }}</td>
                    <td class="tabular">{{ fullNumber(row.input) }}</td>
                    <td class="tabular">{{ fullNumber(row.inputCached) }}</td>
                    <td class="tabular">{{ fullNumber(row.output) }}</td>
                    <td class="tabular">{{ fullNumber(row.outputCached) }}</td>
                    <td class="tabular">{{ formatMs(row.latency) }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="filteredUsageRows.length === 0" class="empty-state">
                <strong>No usage data for this provider.</strong
                ><span>Choose another provider.</span>
              </div>
            </div>
          </section>
        </template>
        <template v-else>
          <section class="section-intro">
            <div>
              <h2>Gateway access keys</h2>
              <p>API keys, scopes, and owners for RouterLM clients.</p>
            </div>
            <label class="search-control"
              ><Search :size="15" /><input
                v-model="query"
                placeholder="Search keys"
                aria-label="Search keys"
            /></label>
          </section>
          <section class="panel table-panel">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Owner</th>
                    <th>Scope</th>
                    <th>Last used</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="key in filteredKeys" :key="key.label">
                    <td>
                      <div class="table-entity">
                        <span class="key-icon"><KeyRound :size="15" /></span
                        ><strong>{{ key.label }}</strong>
                      </div>
                    </td>
                    <td>{{ key.owner }}</td>
                    <td>{{ key.scope }}</td>
                    <td class="tabular">{{ key.lastUsed }}</td>
                    <td>
                      <span class="status-badge" :class="`status-badge--${key.tone}`"
                        ><component :is="toneIcon(key.tone)" :size="13" :stroke-width="2" />{{ key.status }}</span
                      >
                    </td>
                    <td>
                      <button class="row-action" @click="showToast(`Opened ${key.label}`)">
                        Details <ArrowUpRight :size="14" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="filteredKeys.length === 0" class="empty-state">
                <strong>No access keys match.</strong
                ><span>Search by key name or clear the filter.</span>
                <button class="text-button" @click="query = ''">Clear filter</button>
              </div>
            </div>
            <div class="panel-footer">
              <span>The secret is shown once after creation.</span
              ><button class="text-button" @click="createItem('Create API key')">
                Create API key <Plus :size="14" />
              </button>
            </div>
          </section>
        </template>
      </div>
    </main>
    <Transition name="toast"
      ><div v-if="toast" class="toast" role="status" aria-live="polite">
        <ShieldCheck :size="16" />{{ toast }}
      </div></Transition
    >
  </div>
</template>
