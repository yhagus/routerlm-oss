import { defineStore } from "pinia";

type Theme = "light" | "dark" | "system";

export const useThemeStore = defineStore("theme", {
  state: () => ({
    theme:
      (localStorage.getItem("lobakai-theme") as Theme | null) ||
      ("light" as Theme),
  }),
  actions: {
    apply() {
      const dark =
        this.theme === "dark" ||
        (this.theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    },
    toggle() {
      this.theme = this.theme === "dark" ? "light" : "dark";
      localStorage.setItem("lobakai-theme", this.theme);
      this.apply();
    },
  },
});
