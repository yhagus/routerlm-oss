// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";
import packageJson from "./package.json";

// Runs before first paint so a stored theme never flashes the wrong palette.
// With no stored choice, CSS follows prefers-color-scheme.
const themeBootScript = `(function(){try{var t=localStorage.getItem("routerlm-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}})()`;

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  // Authenticated operations console: client-rendered, no SEO surface.
  ssr: false,
  modules: ["@nuxt/content"],
  // Vendored shadcn-vue and AI Elements code is imported explicitly; its index.ts
  // barrels would otherwise register as components. components/content is
  // registered by @nuxt/content itself, without a path prefix.
  components: [{ path: "~/components", ignore: ["ui/**", "ai-elements/**", "content/**"] }],
  content: {
    // node:sqlite, so the build needs no native addon. Under Bun (the dev
    // image) @nuxt/content falls back to bun:sqlite.
    experimental: { sqliteConnector: "native" },
    // Plain code blocks in the theme's ink: a single highlight theme is
    // unreadable in the other color scheme.
    build: { markdown: { highlight: false } },
  },
  runtimeConfig: {
    // Where server/api/[...path].ts forwards dashboard calls. NUXT_BACKEND_URL overrides it.
    backendUrl: "http://localhost:3000",
    public: {
      // The gateway's address as clients reach it, shown in the docs' examples.
      // NUXT_PUBLIC_GATEWAY_URL sets it; empty means the browser's host on port 3000.
      gatewayUrl: "",
      // The web app's release, printed as the docs' revision.
      appVersion: packageJson.version,
    },
  },
  css: ["@fontsource-variable/plus-jakarta-sans", "~/assets/css/main.css"],
  vite: { plugins: [tailwindcss()] },
  app: {
    // A short fade-and-rise between pages (CSS in main.css: .page-*). Each page has one root element.
    pageTransition: { name: "page", mode: "out-in" },
    head: {
      title: "RouterLM",
      htmlAttrs: { lang: "en" },
      meta: [{ name: "color-scheme", content: "light dark" }],
      // The sidebar's brand mark. SVG follows the colour scheme; the .ico and the
      // touch icon are the graphite tile, readable on any tab bar or home screen.
      link: [
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      ],
      script: [{ innerHTML: themeBootScript, tagPosition: "head" }],
    },
  },
});
