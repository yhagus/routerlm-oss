const TOAST_DURATION_MS = 2600;

let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function useToast() {
  const message = useState("toast-message", () => "");

  function showToast(text: string): void {
    message.value = text;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (message.value = ""), TOAST_DURATION_MS);
  }

  return { message, showToast };
}
