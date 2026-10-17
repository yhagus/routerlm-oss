import { defineStore } from "pinia";

/**
 * Pages opt into the shell search field through this small shared contract.
 * Keeping it in the shell avoids each view inventing a different header API.
 */
export const useHeaderSearchStore = defineStore("header-search", {
  state: () => ({ visible: false, query: "", placeholder: "Search" }),
  actions: {
    show(placeholder = "Search") {
      this.visible = true;
      this.placeholder = placeholder;
    },
    hide() {
      this.visible = false;
      this.query = "";
    },
    setQuery(query: string) {
      this.query = query;
    },
  },
});
