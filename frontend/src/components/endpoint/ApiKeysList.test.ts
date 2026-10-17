import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, test } from "vitest";
import type { ApiKey } from "@/types/api";
import ApiKeysList from "./ApiKeysList.vue";

const key: ApiKey = {
  id: "key-1",
  key: "sk-test-key",
  name: "Test key",
  isActive: true,
  visibility: "private",
  isDefault: false,
  usageRequests: 0,
  usageTokens: 0,
  limitMode: "requests",
  limitValue: 10,
  comboAccessMode: "blacklist",
  comboAccessList: [],
  modelAccessMode: "whitelist",
  modelAccessList: [],
  usage: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
};

afterEach(() => {
  document.body.innerHTML = "";
});

function mountList() {
  return mount(ApiKeysList, {
    props: {
      keys: [key],
      pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
      searchInput: "",
      visibilityTab: "private",
    },
  });
}

describe("ApiKeysList row actions", () => {
  test("opens the Teleport menu and emits the selected key", async () => {
    const wrapper = mountList();
    await wrapper.get('[title="More actions"]').trigger("click");
    await nextTick();

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const combo = Array.from(menu!.querySelectorAll("button")).find((button) =>
      button.textContent.includes("Combo access"),
    );
    expect(combo).toBeDefined();
    combo!.click();
    await nextTick();

    expect(wrapper.emitted("editCombo")).toEqual([[key]]);
    wrapper.unmount();
  });

  test("shows the stats button for public keys", async () => {
    const wrapper = mount(ApiKeysList, {
      props: {
        keys: [{ ...key, visibility: "public" }],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
        searchInput: "",
        visibilityTab: "public",
      },
    });

    expect(wrapper.find('[aria-label="Open usage stats"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  test("emits openStats from the menu for a public active key", async () => {
    const wrapper = mount(ApiKeysList, {
      props: {
        keys: [{ ...key, visibility: "public" }],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
        searchInput: "",
        visibilityTab: "public",
      },
    });
    await wrapper.get('[title="More actions"]').trigger("click");
    await nextTick();

    const menu = document.body.querySelector('[role="menu"]');
    const stats = Array.from(menu!.querySelectorAll("button")).find((button) =>
      button.textContent.includes("Open usage stats"),
    );
    expect(stats).toBeDefined();
    stats!.click();
    await nextTick();

    expect(wrapper.emitted("openStats")).toEqual([
      [{ ...key, visibility: "public" }],
    ]);
    wrapper.unmount();
  });

  test("does not show the stats button for private keys", async () => {
    const wrapper = mountList();

    expect(wrapper.find('[aria-label="Open usage stats"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  test("emits a pause request for an active key", async () => {
    const wrapper = mountList();
    await wrapper.get('[role="switch"]').trigger("click");

    expect(wrapper.emitted("pause")).toEqual([[key, false]]);
    wrapper.unmount();
  });
});
