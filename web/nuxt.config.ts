// https://nuxt.com/docs/api/configuration/nuxt-config

// Runs before first paint so a stored theme never flashes the wrong palette.
// With no stored choice, CSS follows prefers-color-scheme.
const themeBootScript = `(function(){try{var t=localStorage.getItem("routerlm-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}})()`;

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  // Authenticated operations console: client-rendered, no SEO surface.
  ssr: false,
  modules: ["@unocss/nuxt"],
  css: ["@fontsource-variable/plus-jakarta-sans", "~/assets/css/main.css"],
  app: {
    head: {
      title: "RouterLM",
      htmlAttrs: { lang: "en" },
      meta: [{ name: "color-scheme", content: "light dark" }],
      script: [{ innerHTML: themeBootScript, tagPosition: "head" }],
    },
  },
});
