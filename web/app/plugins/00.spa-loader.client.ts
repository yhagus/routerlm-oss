// Nuxt removes #__nuxt-loader the instant the app resolves, which reads as a
// flicker. Renaming it hides it from that removal so it can fade out instead.
const FADE_MS = 220;

export default defineNuxtPlugin((nuxtApp) => {
  const found = document.getElementById("__nuxt-loader");
  if (!found) return;
  const loader = found;
  loader.id = "__nuxt-loader-fading";

  let isFading = false;
  function fadeOut(): void {
    if (isFading) return;
    isFading = true;
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
  }

  nuxtApp.hook("app:suspense:resolve", fadeOut);
  // The error page renders outside the suspense boundary, so a 404 on first load never resolves it.
  nuxtApp.hook("app:error", fadeOut);
});
