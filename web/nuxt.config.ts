import tailwindcss from "@tailwindcss/vite";
import packageJson from "./package.json";

const themeBootScript = `(function(){try{var t=localStorage.getItem("routerlm-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}})()`;

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  ssr: false,
  modules: ["@nuxt/content"],
  components: [{ path: "~/components", ignore: ["ui/**", "ai-elements/**", "content/**"] }],
  content: {
    experimental: { sqliteConnector: "native" },
    build: { markdown: { highlight: false } },
  },
  runtimeConfig: {
    backendUrl: "http://localhost:3000",
    public: {
      gatewayUrl: "",
      appVersion: packageJson.version,
    },
  },
  routeRules: {
    "/doc": { redirect: "/docs" },
    "/doc/**": { redirect: "/docs/**" },
  },
  css: ["@fontsource-variable/plus-jakarta-sans", "~/assets/css/main.css"],
  vite: { plugins: [tailwindcss()] },
  app: {
    pageTransition: { name: "page", mode: "out-in" },
    head: {
      title: "RouterLM",
      htmlAttrs: { lang: "en" },
      meta: [{ name: "color-scheme", content: "light dark" }],
      link: [
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      ],
      script: [{ innerHTML: themeBootScript, tagPosition: "head" }],
    },
  },
});
