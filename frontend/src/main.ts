import { createApp } from "vue";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import App from "@/App.vue";
import router from "@/router";
import { useThemeStore } from "@/stores/theme";
import { initializeTranslations, reloadTranslations } from "@/lib/i18n";
import "@/styles/globals.css";

const app = createApp(App);
const pinia = createPinia();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 300_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

app.use(pinia);
app.use(router);
app.use(VueQueryPlugin, { queryClient });

useThemeStore(pinia).apply();
router.afterEach(() => {
  void reloadTranslations();
});
router.isReady().then(() => initializeTranslations());
app.mount("#app");
