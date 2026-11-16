import { onScopeDispose, shallowRef, type ShallowRef } from "vue";

/**
 * - `copied`: the text is on the clipboard.
 * - `manual`: the clipboard refused, so the text is selected for the reader to copy.
 * - `failed`: the clipboard refused and there was nothing to select.
 */
export type CopyState = "idle" | "copied" | "manual" | "failed";

/** How long a copy button shows its result before it reads "Copy" again. */
const FEEDBACK_MS = 1500;
/** The manual fallback stays up longer: the reader still has a key to press. */
const MANUAL_FEEDBACK_MS = 4000;

/** "⌘C" on Apple devices, "Ctrl+C" elsewhere. */
export function copyShortcut(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘C" : "Ctrl+C";
}

function selectContents(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Copies text to the clipboard and reports the result for a short while. */
export function useCopyFeedback(): {
  state: Readonly<ShallowRef<CopyState>>;
  copy: (text: string, selectOnFailure?: HTMLElement | null) => Promise<void>;
} {
  const state = shallowRef<CopyState>("idle");
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  function show(next: CopyState): void {
    clearTimeout(resetTimer);
    state.value = next;
    resetTimer = setTimeout(
      () => (state.value = "idle"),
      next === "manual" ? MANUAL_FEEDBACK_MS : FEEDBACK_MS,
    );
  }

  async function copy(text: string, selectOnFailure?: HTMLElement | null): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      show("copied");
    } catch {
      if (selectOnFailure) {
        selectContents(selectOnFailure);
        show("manual");
      } else {
        show("failed");
      }
    }
  }

  onScopeDispose(() => clearTimeout(resetTimer));

  return { state, copy };
}
