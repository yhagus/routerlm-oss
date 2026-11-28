import { useDocumentVisibility, useIntervalFn } from '@vueuse/core';
import { watch } from 'vue';

export function usePollWhileVisible(poll: () => unknown, intervalMs: number): void {
  const visibility = useDocumentVisibility();
  const { pause, resume } = useIntervalFn(poll, intervalMs, {
    immediate: visibility.value === 'visible',
  });

  watch(visibility, (state) => {
    if (state !== 'visible') {
      pause();
      return;
    }
    poll();
    resume();
  });
}
