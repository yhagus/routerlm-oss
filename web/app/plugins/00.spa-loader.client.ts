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
    requestAnimationFrame(() => {
      screen.classList.add("is-done");
      setTimeout(() => loader.remove(), FADE_MS);
    });
  }

  nuxtApp.hook("app:suspense:resolve", fadeOut);
  nuxtApp.hook("app:error", fadeOut);
});
