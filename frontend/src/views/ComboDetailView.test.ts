import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { describe, expect, test, vi } from "vitest";

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: "combo-1" } }),
  useRouter: () => ({ push: vi.fn() }),
}));

const connections = [
  {
    id: "account-1",
    provider: "openai",
    authType: "api-key",
    name: "First account",
    email: null,
    priority: 1,
    isActive: true,
    apiType: null,
    baseUrl: null,
    credentials: {},
    data: { group: "Team A" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "account-2",
    provider: "openai",
    authType: "api-key",
    name: "Second account",
    email: null,
    priority: 2,
    isActive: true,
    apiType: null,
    baseUrl: null,
    credentials: {},
    data: { group: "Team A" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];
const { updateCombo } = vi.hoisted(() => ({
  updateCombo: vi.fn(async () => ({
    id: "combo-1",
    name: "Fallback",
    kind: null,
    models: ["openai/gpt"],
  })),
}));

vi.mock("@/lib/api", () => ({
  api: {
    combos: {
      get: vi.fn(async () => ({
        id: "combo-1",
        name: "Fallback",
        kind: null,
        models: ["openai/gpt"],
        accountFilters: { "openai/gpt": ["account-1"] },
      })),
      update: updateCombo,
    },
    providers: { list: vi.fn(async () => connections) },
    nodes: { list: vi.fn(async () => []) },
    models: { aliases: vi.fn(async () => ({})) },
  },
}));

import ComboDetailView from "./ComboDetailView.vue";

function mountView() {
  return mount(ComboDetailView, {
    global: {
      plugins: [
        createPinia(),
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
      stubs: {
        PageHeader: { template: "<div><slot /><slot name='actions' /></div>" },
        Card: { template: "<section><slot /></section>" },
        Button: { template: "<button><slot /></button>" },
        Badge: { template: "<span><slot /></span>" },
        EmptyState: { template: "<div><slot /></div>" },
      },
    },
  });
}

describe("ComboDetailView account groups", () => {
  test("shows the only account group and selects every account in that group", async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.text()).toContain("Team A");
    expect(wrapper.text()).toContain("1/2");

    const groupCheckbox = wrapper.findAll('input[type="checkbox"]')[1];
    expect((groupCheckbox.element as HTMLInputElement).indeterminate).toBe(
      true,
    );
    await groupCheckbox.setValue(true);

    const accountCheckboxes = wrapper.findAll(
      'label.cursor-pointer input[type="checkbox"]',
    );
    expect(accountCheckboxes).toHaveLength(2);
    expect(
      accountCheckboxes.every(
        (checkbox) => (checkbox.element as HTMLInputElement).checked,
      ),
    ).toBe(true);
    expect(wrapper.text()).toContain("2/2");

    const followGroup = wrapper
      .findAll("label")
      .find((label) => label.text().includes("Follow group"));
    expect(followGroup).toBeDefined();
    await followGroup!.find('input[type="checkbox"]').setValue(true);
    expect(
      accountCheckboxes.every(
        (checkbox) => (checkbox.element as HTMLInputElement).disabled,
      ),
    ).toBe(true);

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Save routing"))!
      .trigger("click");
    expect(updateCombo).toHaveBeenCalledWith(
      "combo-1",
      expect.objectContaining({
        accountFilters: { "openai/gpt": ["@group:Team A"] },
      }),
    );
  });
});
