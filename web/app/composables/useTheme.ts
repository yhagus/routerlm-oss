import { computed, onMounted, ref } from "vue";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "routerlm-theme";
const NEXT: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const LABELS: Record<ThemePreference, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
};

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {}
}

export function useTheme() {
  const preference = ref<ThemePreference>("system");

  onMounted(() => {
    preference.value = readPreference();
  });

  const nextPreference = computed(() => NEXT[preference.value]);
  const label = computed(() => LABELS[preference.value]);
  const nextLabel = computed(() => LABELS[nextPreference.value]);

  function cycle() {
    preference.value = nextPreference.value;
    applyPreference(preference.value);
  }

  function setPreference(next: ThemePreference) {
    preference.value = next;
    applyPreference(next);
  }

  return { preference, nextPreference, label, nextLabel, cycle, setPreference };
}
