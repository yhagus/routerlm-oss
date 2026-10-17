import { defineStore } from "pinia";

export type NoticeType = "success" | "error" | "info";

export const useNotificationStore = defineStore("notifications", {
  state: () => ({
    notices: [] as {
      id: number;
      type: NoticeType;
      title: string;
      message: string;
    }[],
  }),
  actions: {
    push(type: NoticeType, message: string, title = "") {
      const id = Date.now() + Math.random();
      this.notices.push({ id, type, title, message });
      window.setTimeout(() => this.remove(id), 4500);
    },
    remove(id: number) {
      this.notices = this.notices.filter((notice) => notice.id !== id);
    },
  },
});
