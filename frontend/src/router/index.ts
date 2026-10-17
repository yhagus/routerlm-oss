import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import { defineAsyncComponent, type AsyncComponentLoader } from "vue";
import { useSessionStore } from "@/stores/session";
import RouteFallback from "@/components/app/RouteFallback.vue";

// Wrap a lazy import so the router resolves it *immediately* and the destination
// renders RouteFallback while its chunk/data load. Without this, vue-router awaits
// the chunk before switching, so a slow connection makes the click look dead.
// delay: 150ms avoids a skeleton flash on fast/cached loads.
const view = (loader: AsyncComponentLoader) =>
  defineAsyncComponent({ loader, loadingComponent: RouteFallback, delay: 150 });

const dashboardChildren: RouteRecordRaw[] = [
  {
    path: "",
    name: "dashboard",
    component: view(() => import("@/views/DashboardView.vue")),
    meta: { title: "Dashboard" },
  },
  {
    path: "endpoint",
    name: "endpoint",
    component: view(() => import("@/views/EndpointView.vue")),
    meta: {
      title: "Endpoint & Keys",
      description: "Gateway connection details and access policy",
    },
  },
  {
    path: "providers",
    name: "providers",
    component: view(() => import("@/views/ProvidersView.vue")),
    meta: {
      title: "Providers",
      description: "Accounts and upstream connections",
    },
  },
  {
    path: "providers/new",
    name: "provider-new",
    component: view(() => import("@/views/ProviderNewView.vue")),
    meta: {
      title: "Add Provider",
      description: "Create an upstream provider account",
    },
  },
  {
    path: "providers/:id",
    name: "provider-detail",
    component: view(() => import("@/views/ProviderDetailView.vue")),
    meta: {
      title: "Provider Detail",
      description: "Connection settings and model health",
    },
  },
  {
    path: "proxy-pools",
    name: "proxy-pools",
    component: view(() => import("@/views/ProxyPoolsView.vue")),
    meta: {
      title: "Proxy Pools",
      description: "Reusable outbound network routes",
    },
  },
  {
    path: "combos",
    name: "combos",
    component: view(() => import("@/views/CombosView.vue")),
    meta: { title: "Combos", description: "Ordered fallback routes" },
  },
  {
    path: "vision-adapter",
    name: "vision-adapter",
    component: view(() => import("@/views/VisionAdapterView.vue")),
    meta: {
      title: "Vision Adapter",
      description: "Vision-capable model pools for automatic fallback",
    },
  },
  {
    path: "combos/:id",
    name: "combo-detail",
    component: view(() => import("@/views/ComboDetailView.vue")),
    meta: {
      title: "Combo Detail",
      description: "Account filters and fallback order",
    },
  },
  {
    path: "combos/:id/accounts",
    name: "combo-accounts",
    component: view(() => import("@/views/ComboDetailView.vue")),
    meta: {
      title: "Combo Accounts",
      description: "Account filters and fallback order",
    },
  },
  {
    path: "combos/:id/consumers",
    name: "combo-consumers",
    component: view(() => import("@/views/ComboConsumersView.vue")),
    meta: {
      title: "Combo Consumers",
      description: "API key access for a combo",
    },
  },
  {
    path: "usage",
    name: "usage",
    component: view(() => import("@/views/UsageView.vue")),
    meta: { title: "Usage", description: "Request volume, tokens, and cost" },
  },
  {
    path: "profile",
    redirect: "/dashboard/settings/workspace",
  },
  {
    path: "settings",
    redirect: "/dashboard/settings/workspace",
  },
  {
    path: "settings/:section",
    name: "settings",
    component: view(() => import("@/views/SettingsView.vue")),
    meta: {
      title: "Settings",
      description: "Workspace, access, routing, and connectivity",
    },
  },
  {
    path: "settings/pricing",
    name: "pricing-settings",
    component: view(() => import("@/views/PricingSettingsView.vue")),
    meta: {
      title: "Pricing Settings",
      description: "Model rate-card overrides",
    },
  },
  {
    path: "credentials",
    name: "credentials",
    component: view(() => import("@/views/AccountGroupsView.vue")),
    meta: {
      title: "Credentials",
      description: "Organize provider accounts for combo routing",
    },
  },
  {
    path: "media-providers/web",
    name: "media-web",
    component: view(() => import("@/views/MediaWebView.vue")),
    meta: {
      title: "Web Tools",
      description: "Web search and fetch provider routes",
    },
  },
  {
    path: "media-providers/:kind/:id",
    name: "media-detail",
    component: view(() => import("@/views/MediaDetailView.vue")),
    meta: {
      title: "Media Provider",
      description: "Provider connection and request example",
    },
  },
  {
    path: "media-providers/combo/:id",
    name: "media-combo",
    component: view(() => import("@/views/MediaComboView.vue")),
    meta: {
      title: "Media Combo",
      description: "Media fallback models and accounts",
    },
  },
  {
    path: "media-providers/:kind",
    name: "media-kind",
    component: view(() => import("@/views/MediaKindView.vue")),
    meta: {
      title: "Media Providers",
      description: "Providers for this media capability",
    },
  },
  {
    path: "cli-tools",
    name: "cli-tools",
    component: view(() => import("@/views/CLIToolsView.vue")),
    meta: {
      title: "CLI Tools",
      description: "Manual client setup from the live v2 gateway context",
    },
  },
  {
    path: "cli-tools/:toolId",
    name: "cli-tool-detail",
    component: view(() => import("@/views/CLIToolDetailView.vue")),
    meta: {
      title: "CLI Tool",
      description: "Generate a client configuration handoff",
    },
  },
  {
    path: "skills",
    name: "skills",
    component: view(() => import("@/views/SkillsView.vue")),
    meta: {
      title: "Skills",
      description: "Copy capability instructions for AI agents",
    },
  },
  {
    path: "translator",
    name: "translator",
    component: view(() => import("@/views/TranslatorView.vue")),
    meta: {
      title: "Translator",
      description: "Replay requests through the live v2 compatibility gateway",
    },
  },
  {
    path: "console-log",
    name: "console-log",
    component: view(() => import("@/views/ConsoleLogView.vue")),
    meta: { title: "Console Log", description: "Runtime output stream status" },
  },
  {
    path: "scheduler",
    name: "scheduler",
    component: view(() => import("@/views/SchedulerView.vue")),
    meta: {
      title: "Scheduler",
      description: "Background job status and configuration",
    },
  },
  {
    path: "queue-jobs",
    name: "queue-jobs",
    component: view(() => import("@/views/QueueJobsView.vue")),
    meta: {
      title: "Queue Jobs",
      description: "Live in-memory background job registry",
    },
  },
  {
    path: "quota",
    name: "quota",
    component: view(() => import("@/views/QuotaView.vue")),
    meta: {
      title: "Quota Tracker",
      description: "Provider account status and quota telemetry",
    },
  },
  {
    path: "free-tracker",
    name: "free-tracker",
    component: view(() => import("@/views/FreeTrackerView.vue")),
    meta: {
      title: "Free Tracker",
      description: "Free-model source visibility and pool status",
    },
  },
  {
    path: "token-saver",
    name: "token-saver",
    component: view(() => import("@/views/TokenSaverView.vue")),
    meta: {
      title: "Token Saver",
      description: "Compression controls and token-saver pipeline status",
    },
  },
  {
    path: "mitm",
    name: "mitm",
    component: view(() => import("@/views/MitmView.vue")),
    meta: {
      title: "MITM Tools",
      description: "Local interception controls for IDE clients",
    },
  },
  {
    path: "pxpipe",
    name: "pxpipe",
    component: view(() => import("@/views/PxpipeView.vue")),
    meta: {
      title: "PXPIPE",
      description: "Prompt-image compression telemetry",
    },
  },
  {
    path: "chat",
    name: "chat",
    component: view(() => import("@/views/ChatView.vue")),
    meta: {
      title: "Chat",
      description: "Stream prompts through the v2 gateway",
    },
  },
  {
    path: "basic-chat",
    name: "basic-chat",
    component: view(() => import("@/views/BasicChatView.vue")),
    meta: {
      title: "Basic Chat",
      description:
        "Persistent browser sessions for quick gateway conversations",
    },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: () => import("@/views/HomeStatsView.vue"),
      meta: { public: true },
    },
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
      meta: { public: true },
    },
    {
      path: "/callback",
      name: "callback",
      component: () => import("@/views/CallbackView.vue"),
      meta: { public: true },
    },
    {
      path: "/oauth/callback",
      name: "oauth-callback",
      component: () => import("@/views/CallbackView.vue"),
      meta: { public: true },
    },
    {
      path: "/connect",
      name: "connect",
      component: () => import("@/views/ConnectView.vue"),
      meta: { public: true },
    },
    {
      path: "/dashboard",
      component: () => import("@/layouts/DashboardLayout.vue"),
      children: dashboardChildren,
    },
    { path: "/:pathMatch(.*)*", redirect: "/dashboard" },
  ],
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  await session.check();
  if (to.meta.public) {
    if (to.name === "login" && session.authenticated) return "/dashboard";
    return true;
  }
  if (session.requireLogin && !session.authenticated)
    return { name: "login", query: { redirect: to.fullPath } };
  return true;
});

export default router;
