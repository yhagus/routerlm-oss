<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  ChevronRight,
  CircleUserRound,
  History,
  LogOut,
  Menu,
  Power,
  Search,
  X,
} from "lucide-vue-next";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import { providerMeta } from "@/lib/providerMeta";
import { useSessionStore } from "@/stores/session";
import { useNotificationStore } from "@/stores/notifications";
import { useHeaderSearchStore } from "@/stores/headerSearch";
import Button from "@/components/ui/button.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import LanguageSwitcher from "@/components/app/LanguageSwitcher.vue";
import ChangelogModal from "@/components/app/ChangelogModal.vue";
import ThemeToggle from "@/components/app/ThemeToggle.vue";

defineEmits<{ menu: [] }>();
const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const notifications = useNotificationStore();
const search = useHeaderSearchStore();
const menuOpen = ref(false);
const logoutOpen = ref(false);
const shutdownOpen = ref(false);
const disconnectOpen = ref(false);
const shuttingDown = ref(false);
const identity = ref<{
  displayName: string;
  loginMethod: "OIDC" | "Password";
} | null>(null);
const changelogOpen = ref(false);

const page = computed(() => {
  const path = route.path;
  const providerMatch = path.match(/^\/dashboard\/providers\/([^/]+)$/);
  if (providerMatch) {
    const provider = providerMeta(providerMatch[1]);
    const label = provider.name || providerMatch[1];
    return {
      title: label,
      description: "",
      crumbs: [{ label: "Providers", to: "/dashboard/providers" }, { label }],
    };
  }
  const mediaMatch = path.match(
    /^\/dashboard\/media-providers\/([^/]+)\/([^/]+)$/,
  );
  if (mediaMatch) {
    const kind = mediaMatch[1];
    const provider = providerMeta(mediaMatch[2]);
    const label = provider.name || mediaMatch[2];
    return {
      title: label,
      description: "",
      crumbs: [
        { label: "Media Providers", to: `/dashboard/media-providers/${kind}` },
        { label },
      ],
    };
  }
  return {
    title: String(route.meta.title || "Dashboard"),
    description: String(route.meta.description || ""),
    crumbs: [] as Array<{ label: string; to?: string }>,
  };
});

async function logout() {
  menuOpen.value = false;
  logoutOpen.value = false;
  await session.logout();
  notifications.push("info", "Your dashboard session has ended.");
  await router.push("/login");
}

async function shutdown() {
  shuttingDown.value = true;
  try {
    await api.version.shutdown();
    shutdownOpen.value = false;
    disconnectOpen.value = true;
  } catch (error) {
    notifications.push(
      "error",
      error instanceof Error ? error.message : "Unable to stop the server.",
    );
  } finally {
    shuttingDown.value = false;
  }
}

function closeMenu(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest("[data-header-menu]"))
    menuOpen.value = false;
}

function reloadPage() {
  globalThis.location.reload();
}

onMounted(async () => {
  document.addEventListener("click", closeMenu);
  try {
    const status = await api.auth.status();
    if (status.loginMethod === "OIDC" && status.displayName)
      identity.value = {
        displayName: status.displayName,
        loginMethod: status.loginMethod,
      };
  } catch {
    /* The header remains usable when status lookup is unavailable. */
  }
});
onUnmounted(() => document.removeEventListener("click", closeMenu));
</script>

<template>
  <header
    class="icon-scale relative z-20 flex items-center justify-between gap-3 border-b border-border/80 bg-background/75 px-4 pb-2 pt-3 backdrop-blur-xl lg:bg-transparent lg:px-8 lg:backdrop-blur-none"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        class="lg:hidden"
        aria-label="Open navigation"
        @click="$emit('menu')"
        ><Menu class="size-5"
      /></Button>
      <div class="min-w-0">
        <div v-if="page.crumbs.length" class="flex items-center gap-2">
          <template
            v-for="(crumb, index) in page.crumbs"
            :key="`${crumb.label}-${index}`"
          >
            <ChevronRight
              v-if="index"
              class="size-4 shrink-0 text-muted-foreground"
            />
            <RouterLink
              v-if="crumb.to"
              :to="crumb.to"
              class="truncate text-sm text-muted-foreground hover:text-primary"
              >{{ crumb.label }}</RouterLink
            >
            <h1
              v-else
              class="truncate text-base font-semibold tracking-tight lg:text-2xl"
            >
              {{ crumb.label }}
            </h1>
          </template>
        </div>
        <template v-else>
          <h1
            class="truncate text-base font-semibold tracking-tight lg:text-2xl"
          >
            {{ page.title }}
          </h1>
          <p
            v-if="page.description"
            class="hidden truncate text-sm text-muted-foreground lg:block"
          >
            {{ page.description }}
          </p>
        </template>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1.5">
      <div v-if="search.visible" class="relative hidden sm:block">
        <Search
          class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          :value="search.query"
          :placeholder="search.placeholder"
          class="h-8 w-44 rounded-lg border border-border bg-background/70 pl-7 pr-7 text-sm outline-none focus:border-primary/60"
          @input="search.setQuery(($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="search.query"
          class="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
          @click="search.setQuery('')"
        >
          <X class="size-3.5" />
        </button>
      </div>
      <ThemeToggle />
      <LanguageSwitcher />
      <div
        v-if="identity"
        class="hidden max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs text-muted-foreground sm:flex"
        :title="identity.displayName"
      >
        <CircleUserRound class="size-3.5 shrink-0 text-primary" /><span
          class="truncate"
          >{{ identity.displayName }}</span
        ><span
          class="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
          >OIDC</span
        >
      </div>
      <div data-header-menu class="relative">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Account menu"
          @click="menuOpen = !menuOpen"
          ><CircleUserRound class="size-4"
        /></Button>
        <div
          v-if="menuOpen"
          class="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          <button
            class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
            @click="
              changelogOpen = true;
              menuOpen = false;
            "
          >
            <History class="size-4" />Change Log
          </button>
          <button
            class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
            @click="
              shutdownOpen = true;
              menuOpen = false;
            "
          >
            <Power class="size-4" />Shutdown
          </button>
          <button
            class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
            @click="
              logoutOpen = true;
              menuOpen = false;
            "
          >
            <LogOut class="size-4" />Log out
          </button>
        </div>
      </div>
    </div>
  </header>
  <ChangelogModal :open="changelogOpen" @close="changelogOpen = false" />
  <ConfirmModal
    :open="shutdownOpen"
    title="Shutdown LobakAI"
    message="Stop the local server? Existing requests will be interrupted."
    confirm-text="Shutdown"
    :loading="shuttingDown"
    @close="shutdownOpen = false"
    @confirm="shutdown"
  />
  <ConfirmModal
    :open="logoutOpen"
    title="Log out"
    message="End the current dashboard session?"
    confirm-text="Log out"
    @close="logoutOpen = false"
    @confirm="logout"
  />
  <div
    v-if="disconnectOpen"
    class="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-6 text-center text-white backdrop-blur-sm"
  >
    <div>
      <Power class="mx-auto mb-4 size-12 text-red-400" />
      <h2 class="text-xl font-semibold">Server Disconnected</h2>
      <p class="mt-2 text-sm text-white/65">
        The local server has been stopped.
      </p>
      <Button class="mt-5" variant="secondary" @click="reloadPage"
        >Reload page</Button
      >
    </div>
  </div>
</template>
