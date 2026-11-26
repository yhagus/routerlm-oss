import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export function useIsDark(): Ref<boolean> {
  const isDark = ref(false);
  let media: MediaQueryList | undefined;
  let observer: MutationObserver | undefined;

  function update(): void {
    const theme = document.documentElement.dataset.theme;
    isDark.value = theme ? theme === 'dark' : Boolean(media?.matches);
  }

  onMounted(() => {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    update();
  });

  onBeforeUnmount(() => {
    media?.removeEventListener('change', update);
    observer?.disconnect();
  });

  return isDark;
}
