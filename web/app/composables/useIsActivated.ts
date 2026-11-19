import { onActivated, onDeactivated, ref, type Ref } from "vue";

/**
 * False while a kept-alive component is hidden behind another one. Its
 * document-wide listeners, such as a composer's file drop, should go with it.
 */
export function useIsActivated(): Readonly<Ref<boolean>> {
  const isActivated = ref(true);
  onActivated(() => (isActivated.value = true));
  onDeactivated(() => (isActivated.value = false));
  return isActivated;
}
