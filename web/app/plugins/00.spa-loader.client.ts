const FADE_MS = 220;

export default defineNuxtPlugin((nuxtApp) => {
  const bootScreen = document.querySelector<HTMLElement>('.rlm-boot');
  if (!bootScreen) return;
  const screen = bootScreen;
  moveOutOfNuxtLoaderSoItOutlivesIt(screen);

  let isFading = false;
  function fadeOut(): void {
    if (isFading) return;
    isFading = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      screen.remove();
      return;
    }
    requestAnimationFrame(() => {
      screen.classList.add('is-done');
      setTimeout(() => screen.remove(), FADE_MS);
    });
  }

  nuxtApp.hook('app:suspense:resolve', fadeOut);
  nuxtApp.hook('app:error', fadeOut);
});

function moveOutOfNuxtLoaderSoItOutlivesIt(screen: HTMLElement): void {
  document.body.append(screen);
}
