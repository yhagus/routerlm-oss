import { onActivated, onDeactivated, ref, type Ref } from "vue";

export function useIsActivated(): Readonly<Ref<boolean>> {
  const isActivated = ref(true);
  onActivated(() => (isActivated.value = true));
  onDeactivated(() => (isActivated.value = false));
  return isActivated;
}
