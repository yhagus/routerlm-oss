<script setup lang="ts">
import { LogOut, Menu, Monitor, Moon, ShieldCheck, Sun, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { findNavigationItem, navigationGroups } from "~/lib/navigation";

const route = useRoute();
const theme = useTheme();
const currentUser = useCurrentUser();
const { message: toastMessage } = useToast();
const { $dashboardApi } = useNuxtApp();

const isMobileNavOpen = ref(false);
watch(
  () => route.path,
  () => (isMobileNavOpen.value = false),
);

/** The sidebar item the current page belongs to; detail pages like /providers/<id> count. */
const activeItem = computed(() => findNavigationItem(route.path));
const pageError = useError();
/** On the error page an address outside every section still needs a crumb. */
const pageTitle = computed(() => {
  if (activeItem.value) return activeItem.value.label;
  if (!pageError.value) return "";
  return pageError.value.statusCode === 404 ? "Not found" : "Error";
});
const themeIcon = computed(() => {
  if (theme.preference.value === "dark") return Moon;
  if (theme.preference.value === "light") return Sun;
  return Monitor;
});
const userInitial = computed(() => currentUser.value?.email.charAt(0).toUpperCase() ?? "");

async function signOut(): Promise<void> {
  await $dashboardApi("/auth/logout", { method: "POST" });
  currentUser.value = null;
  await navigateTo("/login");
}
</script>

<template>
  <div class="app-shell">
    <div v-if="isMobileNavOpen" class="nav-scrim" @click="isMobileNavOpen = false" />
    <aside class="sidebar" :class="{ 'sidebar--open': isMobileNavOpen }">
      <div class="sidebar__brand">
        <div class="brand">
          <span class="brand__mark">R</span><span>router<span>lm</span></span>
        </div>
        <button
          class="icon-button sidebar__close"
          aria-label="Close navigation"
          @click="isMobileNavOpen = false"
        >
          <X :size="18" />
        </button>
      </div>
      <nav class="sidebar__nav" aria-label="Primary navigation">
        <template v-for="group in navigationGroups" :key="group.label">
          <span class="nav-group-label">{{ group.label }}</span>
          <NuxtLink
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{ 'nav-item--active': activeItem?.path === item.path }"
            :aria-current="activeItem?.path === item.path ? 'page' : undefined"
            active-class=""
            exact-active-class=""
          >
            <component :is="item.icon" :size="17" :stroke-width="1.8" /><span>{{
              item.label
            }}</span>
          </NuxtLink>
        </template>
      </nav>
      <div class="sidebar__footer">
        <div class="profile">
          <span class="profile__avatar" aria-hidden="true">{{ userInitial }}</span
          ><span><strong>{{ currentUser?.email }}</strong><small>Signed in</small></span
          ><button class="icon-button" aria-label="Sign out" title="Sign out" @click="signOut">
            <LogOut :size="15" />
          </button>
        </div>
      </div>
    </aside>
    <main class="main-content">
      <header class="topbar">
        <button
          class="icon-button mobile-menu"
          aria-label="Open navigation"
          @click="isMobileNavOpen = true"
        >
          <Menu :size="20" />
        </button>
        <div class="breadcrumbs">
          <span>RouterLM</span><span>/</span><strong>{{ pageTitle }}</strong>
        </div>
        <div class="topbar__actions">
          <TimeZoneMenu />
          <AppSelect
            class="topbar__theme-select"
            menu-class="topbar__theme-menu"
            menu-align="end"
            :model-value="theme.preference.value"
            label="Color theme"
            :options="[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]"
            @update:model-value="theme.setPreference"
          >
            <template #leading
              ><component :is="themeIcon" :size="15" :stroke-width="1.8"
            /></template>
          </AppSelect>
        </div>
      </header>
      <div class="page-wrap">
        <slot />
      </div>
    </main>
    <CatalogGapsNotice />
    <Transition name="toast"
      ><div v-if="toastMessage" class="toast" role="status" aria-live="polite">
        <ShieldCheck :size="16" />{{ toastMessage }}
      </div></Transition
    >
  </div>
</template>
