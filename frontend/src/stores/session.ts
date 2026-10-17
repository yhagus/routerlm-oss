import { defineStore } from "pinia";
import { api, ApiError } from "@/lib/api";

export const useSessionStore = defineStore("session", {
  state: () => ({
    checked: false,
    authenticated: false,
    requireLogin: true,
    loading: false,
  }),
  actions: {
    async check() {
      if (this.checked) return;
      try {
        const status = await api.auth.status();
        this.authenticated = status.authenticated;
        this.requireLogin = status.requireLogin;
      } catch {
        this.authenticated = false;
      } finally {
        this.checked = true;
      }
    },
    async login(password: string) {
      this.loading = true;
      try {
        await api.auth.login(password);
        this.authenticated = true;
        this.checked = true;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new Error("Unable to reach the backend");
      } finally {
        this.loading = false;
      }
    },
    async logout() {
      await api.auth.logout().catch(() => undefined);
      this.authenticated = false;
      this.checked = true;
    },
  },
});
