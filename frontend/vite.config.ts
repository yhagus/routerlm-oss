import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./package.json", import.meta.url)),
    "utf8",
  ),
) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const backendOrigin = env.VITE_BACKEND_ORIGIN || "http://127.0.0.1:20129";
  const host = env.VITE_HOST || "127.0.0.1";
  const proxy = {
    target: backendOrigin,
    changeOrigin: false,
  };

  return {
    plugins: [vue(), tailwindcss()],
    define: {
      // Uses the frontend package version. Keep it aligned with the root release.
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      host,
      port: 20130,
      strictPort: true,
      proxy: {
        "/api": proxy,
        "/v1": proxy,
        "/v1beta": proxy,
        "/responses": proxy,
        "/codex": proxy,
      },
    },
    preview: {
      host,
      port: 20130,
      strictPort: true,
      allowedHosts: ["ai.lobakmerah.my.id"],
      proxy: {
        "/api": proxy,
        "/v1": proxy,
        "/v1beta": proxy,
        "/responses": proxy,
        "/codex": proxy,
      },
    },
  };
});
