<script setup lang="ts">
import { BookOpen, Menu, X } from "@lucide/vue";
import { ref, watch } from "vue";

const route = useRoute();
const isMobileNavOpen = ref(false);
watch(
  () => route.path,
  () => (isMobileNavOpen.value = false),
);

// The page files are numbered (1.authentication.md, ...), so their stems sort in reading order.
const { data: docsPages, status: docsPagesStatus } = useAsyncData(
  "docs-navigation",
  () => queryCollection("docs").order("stem", "ASC").select("title", "path").all(),
  { lazy: true },
);
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
      <nav class="sidebar__nav docs-nav" aria-label="Documentation">
        <span class="nav-group-label">Client documentation</span>
        <span v-if="docsPagesStatus === 'pending' && !docsPages" class="nav-item"
          ><AppSpinner
        /></span>
        <NuxtLink
          v-for="page in docsPages"
          :key="page.path"
          :to="page.path"
          class="nav-item"
          active-class=""
          exact-active-class="nav-item--active"
        >
          <BookOpen :size="17" :stroke-width="1.8" /><span>{{ page.title }}</span>
        </NuxtLink>
      </nav>
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
        <div class="breadcrumbs"><span>RouterLM</span><span>/</span><strong>Docs</strong></div>
      </header>
      <div class="page-wrap">
        <slot />
      </div>
    </main>
  </div>
</template>
