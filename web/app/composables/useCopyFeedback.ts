import { onScopeDispose, shallowRef, type ShallowRef } from 'vue';

export type CopyState = 'idle' | 'copied' | 'manual' | 'failed';

const FEEDBACK_MS = 1500;
const MANUAL_FEEDBACK_MS = 4000;

export function copyShortcut(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘C' : 'Ctrl+C';
}

function selectContents(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function useCopyFeedback(): {
  state: Readonly<ShallowRef<CopyState>>;
  copy: (text: string, selectOnFailure?: HTMLElement | null) => Promise<void>;
} {
  const state = shallowRef<CopyState>('idle');
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  function show(next: CopyState): void {
    clearTimeout(resetTimer);
    state.value = next;
    resetTimer = setTimeout(
      () => (state.value = 'idle'),
      next === 'manual' ? MANUAL_FEEDBACK_MS : FEEDBACK_MS,
    );
  }

  async function copy(text: string, selectOnFailure?: HTMLElement | null): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      show('copied');
    } catch {
      if (selectOnFailure) {
        selectContents(selectOnFailure);
        show('manual');
      } else {
        show('failed');
      }
    }
  }

  onScopeDispose(() => clearTimeout(resetTimer));

  return { state, copy };
}
