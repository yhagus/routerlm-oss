import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import ProviderTopology from "./ProviderTopology.vue";

describe("ProviderTopology", () => {
  test("renders the router and upstream providers", () => {
    const wrapper = mount(ProviderTopology, {
      props: {
        providers: [
          { provider: "openai", name: "OpenAI account" },
          { provider: "anthropic", name: "Anthropic account" },
        ],
        activeRequests: [
          {
            provider: "openai",
            model: "gpt-test",
            account: "OpenAI account",
            count: 1,
          },
        ],
        lastProvider: "anthropic",
      },
    });

    expect(wrapper.text()).toContain("LobakAI");
    expect(wrapper.find('[aria-label="OpenAI"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Anthropic"]').exists()).toBe(true);
    expect(wrapper.find(".topology-provider-active").exists()).toBe(true);
    expect(wrapper.find(".topology-provider-last").exists()).toBe(true);
    expect(wrapper.findAll(".topology-edge-last")).toHaveLength(0);
    expect(wrapper.findAll(".topology-edge-error")).toHaveLength(0);
    expect(wrapper.findAll("path").length).toBeGreaterThan(1);

    wrapper.unmount();
  });

  test("shows the empty state without providers", () => {
    const wrapper = mount(ProviderTopology);

    expect(wrapper.text()).toContain("No providers connected");
    expect(wrapper.find("svg").exists()).toBe(false);

    wrapper.unmount();
  });

  test("supports zoom controls and reset", async () => {
    const wrapper = mount(ProviderTopology, {
      props: { providers: [{ provider: "openai" }] },
    });

    expect(wrapper.text()).toContain("100%");
    await wrapper.get('[aria-label="Zoom in"]').trigger("click");
    expect(wrapper.text()).toContain("110%");
    await wrapper.get('[aria-label="Reset view"]').trigger("click");
    expect(wrapper.text()).toContain("100%");

    wrapper.unmount();
  });
});
