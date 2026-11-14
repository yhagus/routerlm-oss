// Nuxt removes #__nuxt-loader the instant the app resolves, which reads as a
// flicker. Renaming it hides it from that removal so it can fade out instead.
const FADE_MS = 220;

export default defineNuxtPlugin((nuxtApp) => {
  const loader = document.getElementById("__nuxt-loader");
  if (!loader) return;
  loader.id = "__nuxt-loader-fading";

  nuxtApp.hook("app:suspense:resolve", () => {
    const screen = loader.querySelector<HTMLElement>(".rlm-boot");
    if (!screen || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      loader.remove();
      return;
    }
    // Wait one frame so the mounted app paints underneath before fading.
    requestAnimationFrame(() => {
      screen.classList.add("is-done");
      setTimeout(() => loader.remove(), FADE_MS);
    });
  });
});
