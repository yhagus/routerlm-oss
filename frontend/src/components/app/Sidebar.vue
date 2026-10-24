<script setup lang="ts">
import { onMounted, ref, watch, type Component } from "vue";
import LobakLogo from "@/components/app/LobakLogo.vue";
import { RouterLink, useRoute } from "vue-router";
import {
  Activity,
  AlertTriangle,
  AudioLines,
  Binary,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Globe,
  Image as ImageIcon,
  Images,
  Languages,
  Layers3,
  ListChecks,
  MessageCircle,
  Mic,
  Monitor,
  Network,
  Palette,
  Plug,
  Route,
  ScrollText,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Timer,
  Video,
  Wifi,
  X,
  Zap,
} from "lucide-vue-next";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

defineEmits<{ close: [] }>();
const route = useRoute();
const APP_VERSION = __APP_VERSION__;
type NavItem = { label: string; to: string; icon: Component; exact?: boolean };
const navItems: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: Activity, exact: true },
  {
    label: "Endpoint & Key",
    to: "/dashboard/endpoint",
    icon: SlidersHorizontal,
  },
  { label: "Providers", to: "/dashboard/providers", icon: Plug },
  { label: "Combos", to: "/dashboard/combos", icon: Layers3 },
  { label: "Vision Adapter", to: "/dashboard/vision-adapter", icon: Eye },
  { label: "Usage", to: "/dashboard/usage", icon: ChartNoAxesCombined },
  { label: "Quota Tracker", to: "/dashboard/quota", icon: Database },
  { label: "Token Saver", to: "/dashboard/token-saver", icon: Zap },
  { label: "CLI Tools", to: "/dashboard/cli-tools", icon: TerminalSquare },
];
const integrationsItems: NavItem[] = [
  { label: "Chat", to: "/dashboard/chat", icon: MessageCircle },
];
const systemItems: NavItem[] = [
  { label: "Proxy Pools", to: "/dashboard/proxy-pools", icon: Network },
  { label: "Skills", to: "/dashboard/skills", icon: Sparkles },
];
const logsItems: NavItem[] = [
  { label: "Console", to: "/dashboard/console-log", icon: ScrollText },
  { label: "Scheduler", to: "/dashboard/scheduler", icon: Timer },
  { label: "Queue Jobs", to: "/dashboard/queue-jobs", icon: ListChecks },
];
const mediaItems: NavItem[] = [
  {
    label: "Embedding",
    to: "/dashboard/media-providers/embedding",
    icon: Binary,
  },
  {
    label: "Text to Image",
    to: "/dashboard/media-providers/image",
    icon: ImageIcon,
  },
  { label: "Video", to: "/dashboard/media-providers/video", icon: Video },
  {
    label: "Text To Speech",
    to: "/dashboard/media-providers/tts",
    icon: AudioLines,
  },
  {
    label: "Speech To Text",
    to: "/dashboard/media-providers/stt",
    icon: Mic,
  },
  {
    label: "Web Fetch & Search",
    to: "/dashboard/media-providers/web",
    icon: Globe,
  },
];
const settingsItems: NavItem[] = [
  { label: "Workspace", to: "/dashboard/settings/workspace", icon: Palette },
  { label: "Data & Backup", to: "/dashboard/settings/data", icon: Database },
  { label: "Access", to: "/dashboard/settings/access", icon: Shield },
  { label: "Routing", to: "/dashboard/settings/routing", icon: Route },

  { label: "Network", to: "/dashboard/settings/network", icon: Wifi },
  {
    label: "Diagnostics",
    to: "/dashboard/settings/diagnostics",
    icon: Monitor,
  },
  {
    label: "Danger Zone",
    to: "/dashboard/settings/danger",
    icon: AlertTriangle,
  },
];
const active = (item: Pick<NavItem, "to"> & { exact?: boolean }) =>
  item.exact ? route.path === item.to : route.path.startsWith(item.to);
const logsOpen = ref(false);
const mediaOpen = ref(false);
const settingsOpen = ref(false);
const translatorEnabled = ref(false);

watch(
  () => route.path,
  (path) => {
    if (
      path.startsWith("/dashboard/console-log") ||
      path.startsWith("/dashboard/scheduler") ||
      path.startsWith("/dashboard/queue-jobs")
    ) {
      logsOpen.value = true;
    }
    if (path.startsWith("/dashboard/settings")) settingsOpen.value = true;
  },
  { immediate: true },
);

onMounted(async () => {
  try {
    const settings = await api.settings.get();
    translatorEnabled.value = settings.enableTranslator === true;
  } catch {
    translatorEnabled.value = false;
  }
});
</script>

<template>
  <aside
    class="theme-v2 flex min-h-0 shrink-0 flex-col border-r border-border bg-sidebar"
  >
    <div class="flex items-center gap-2 px-6 pb-2 pt-5" aria-hidden="true">
      <span class="size-3 rounded-full bg-[#FF5F56]" /><span
        class="size-3 rounded-full bg-[#FFBD2E]"
      /><span class="size-3 rounded-full bg-[#27C93F]" />
    </div>
    <div class="flex items-center justify-between px-5 pb-4 pt-3">
      <RouterLink
        to="/dashboard"
        class="flex items-center gap-3"
        @click="$emit('close')"
      >
        <LobakLogo
          class="size-9 rounded-[9px] shadow-[0_8px_22px_-8px_var(--primary)]"
        />
        <div>
          <p class="text-[15px] font-semibold tracking-tight">LobakAI</p>
          <p class="text-[11px] text-muted-foreground">v{{ APP_VERSION }}</p>
        </div>
      </RouterLink>
      <button
        class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary lg:hidden"
        aria-label="Close navigation"
        @click="$emit('close')"
      >
        <X class="size-4" />
      </button>
    </div>
    <nav class="flex-1 space-y-0.5 overflow-y-auto px-3 pb-6">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :class="
          cn(
            'group flex items-center gap-3 rounded-[7px] px-3 py-1.5 text-sm font-medium transition-colors',
            active(item)
              ? 'bg-primary/12 font-semibold text-primary'
              : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
          )
        "
        @click="$emit('close')"
      >
        <component
          :is="item.icon"
          :class="
            cn(
              'size-[17px] transition-transform',
              active(item) ? 'stroke-[2.3]' : 'group-hover:translate-x-0.5',
            )
          "
        />
        <span class="flex-1">{{ item.label }}</span>
        <ChevronRight v-if="active(item)" class="size-3.5 opacity-70" />
      </RouterLink>

      <section class="mt-3 space-y-0.5 border-t border-border/70 pt-3">
        <p
          class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.115em] text-muted-foreground"
        >
          Integrations
        </p>
        <RouterLink
          v-for="item in integrationsItems"
          :key="item.to"
          :to="item.to"
          :class="
            cn(
              'group flex items-center gap-3 rounded-[7px] px-3 py-1.5 text-sm font-medium transition-colors',
              active(item)
                ? 'bg-primary/12 font-semibold text-primary'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
            )
          "
          @click="$emit('close')"
        >
          <component
            :is="item.icon"
            :class="
              cn(
                'size-[17px] transition-transform',
                active(item) ? 'stroke-[2.3]' : 'group-hover:translate-x-0.5',
              )
            "
          />
          <span class="flex-1">{{ item.label }}</span>
          <ChevronRight v-if="active(item)" class="size-3.5 opacity-70" />
        </RouterLink>
      </section>

      <section class="mt-2 space-y-0.5 pt-3">
        <p
          class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.115em] text-muted-foreground"
        >
          System
        </p>
        <button
          type="button"
          :class="
            cn(
              'group flex w-full items-center gap-3 rounded-[7px] px-3 py-1.5 text-left transition-all',
              route.path.startsWith('/dashboard/media-providers')
                ? 'bg-primary/12 font-semibold text-primary'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
            )
          "
          @click="mediaOpen = !mediaOpen"
        >
          <Images class="size-[17px]" />
          <span class="flex-1 text-sm font-medium">Media Providers</span>
          <ChevronDown
            class="size-3.5 transition-transform"
            :class="mediaOpen ? 'rotate-180' : ''"
          />
        </button>
        <div v-if="mediaOpen" class="pl-4">
          <RouterLink
            v-for="item in mediaItems"
            :key="item.to"
            :to="item.to"
            :class="
              cn(
                'group flex items-center gap-3 rounded-[7px] px-4 py-1 transition-all',
                active(item)
                  ? 'bg-primary/12 font-semibold text-primary'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
              )
            "
            @click="$emit('close')"
          >
            <component :is="item.icon" class="size-[16px]" />
            <span class="text-sm">{{ item.label }}</span>
          </RouterLink>
        </div>
        <RouterLink
          v-for="item in systemItems"
          :key="item.to"
          :to="item.to"
          :class="
            cn(
              'group flex items-center gap-3 rounded-[7px] px-3 py-1.5 transition-all',
              active(item)
                ? 'bg-primary/12 font-semibold text-primary'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
            )
          "
          @click="$emit('close')"
        >
          <component
            :is="item.icon"
            :class="
              cn(
                'size-[17px] transition-transform',
                active(item) ? 'stroke-[2.3]' : 'group-hover:translate-x-0.5',
              )
            "
          />
          <span class="text-sm font-medium">{{ item.label }}</span>
        </RouterLink>
        <button
          type="button"
          :class="
            cn(
              'group flex w-full items-center gap-3 rounded-[7px] px-3 py-1.5 text-left transition-all',
              route.path.startsWith('/dashboard/console-log') ||
                route.path.startsWith('/dashboard/scheduler') ||
                route.path.startsWith('/dashboard/queue-jobs')
                ? 'bg-primary/12 font-semibold text-primary'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
            )
          "
          @click="logsOpen = !logsOpen"
        >
          <ScrollText class="size-[17px]" />
          <span class="flex-1 text-sm font-medium">Logs</span>
          <ChevronDown
            class="size-3.5 transition-transform"
            :class="logsOpen ? 'rotate-180' : ''"
          />
        </button>
        <div v-if="logsOpen" class="pl-4">
          <RouterLink
            v-for="item in logsItems"
            :key="item.to"
            :to="item.to"
            :class="
              cn(
                'group flex items-center gap-3 rounded-[7px] px-4 py-1 transition-all',
                active(item)
                  ? 'bg-primary/12 font-semibold text-primary'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
              )
            "
            @click="$emit('close')"
          >
            <component :is="item.icon" class="size-[16px]" />
            <span class="text-sm">{{ item.label }}</span>
          </RouterLink>
        </div>
        <RouterLink
          v-if="translatorEnabled"
          to="/dashboard/translator"
          :class="
            cn(
              'group flex items-center gap-3 rounded-[7px] px-3 py-1.5 transition-all',
              active({ to: '/dashboard/translator' })
                ? 'bg-primary/12 font-semibold text-primary'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
            )
          "
          @click="$emit('close')"
        >
          <Languages class="size-[17px]" />
          <span class="text-sm font-medium">Translator</span>
        </RouterLink>
        <button
          type="button"
          :class="
            cn(
              'group flex w-full items-center gap-3 rounded-[7px] px-3 py-1.5 text-left transition-all',
              route.path.startsWith('/dashboard/settings')
                ? 'bg-primary/12 font-semibold text-primary'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
            )
          "
          @click="settingsOpen = !settingsOpen"
        >
          <Settings class="size-[17px]" />
          <span class="flex-1 text-sm font-medium">Settings</span>
          <ChevronDown
            class="size-3.5 transition-transform"
            :class="settingsOpen ? 'rotate-180' : ''"
          />
        </button>
        <div v-if="settingsOpen" class="pl-4">
          <RouterLink
            v-for="item in settingsItems"
            :key="item.to"
            :to="item.to"
            :class="
              cn(
                'group flex items-center gap-3 rounded-[7px] px-4 py-1 transition-all',
                active(item)
                  ? 'bg-primary/12 font-semibold text-primary'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
              )
            "
            @click="$emit('close')"
          >
            <component :is="item.icon" class="size-[16px]" />
            <span class="text-sm">{{ item.label }}</span>
          </RouterLink>
        </div>
      </section>
    </nav>
  </aside>
</template>
