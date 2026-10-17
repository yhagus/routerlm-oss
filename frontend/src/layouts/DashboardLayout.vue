<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { RouterView } from "vue-router";
import Sidebar from "@/components/app/Sidebar.vue";
import Topbar from "@/components/app/Topbar.vue";
import ToastStack from "@/components/app/ToastStack.vue";
import { useRoute } from "vue-router";

const route = useRoute();
const mobileOpen = ref(false);
const scroller = ref<HTMLElement | null>(null);
watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false;
  },
);
// KeepAlive restores pages, but the scroll position now lives on this container.
// Start each navigation at the top. Query-only changes (filters, tabs) keep it.
watch(
  () => route.path,
  () => {
    void nextTick(() => scroller.value?.scrollTo({ top: 0 }));
  },
);
</script>

<template>
  <div class="h-dvh overflow-hidden bg-background lg:flex">
    <div
      class="page-grid pointer-events-none fixed inset-0 opacity-50"
      aria-hidden="true"
    />
    <Sidebar class="relative z-10 hidden h-full w-64 shrink-0 lg:flex" />
    <Transition name="fade">
      <div
        v-if="mobileOpen"
        class="fixed inset-0 z-40 bg-black/30 lg:hidden"
        @click="mobileOpen = false"
      />
    </Transition>
    <Transition name="drawer">
      <Sidebar
        v-if="mobileOpen"
        class="fixed inset-y-0 left-0 z-50 flex w-[min(19rem,88vw)] lg:hidden"
        @close="mobileOpen = false"
      />
    </Transition>
    <main class="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <Topbar class="shrink-0" @menu="mobileOpen = true" />
      <div
        ref="scroller"
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        <div
          class="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-6 sm:px-6 lg:px-10 lg:pt-8"
        >
          <!-- Keep visited pages mounted so back/forward is instant and avoids refetch.
             Keyed by path: a new :id remounts (fresh data), the same path restores. -->
          <RouterView v-slot="{ Component, route: current }">
            <KeepAlive :max="8">
              <component :is="Component" :key="current.path" />
            </KeepAlive>
          </RouterView>
        </div>
      </div>
    </main>
    <ToastStack />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 180ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(-100%);
}
</style>
