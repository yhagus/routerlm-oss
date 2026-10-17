import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { afterEach, describe, expect, test } from "vitest";
import Select from "./select.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Select", () => {
  test("contains the closed Teleport placeholder inside the Select wrapper", () => {
    const Host = defineComponent({
      components: { Select },
      setup() {
        return {
          value: ref("today"),
          options: [{ value: "today", label: "Today" }],
        };
      },
      template:
        '<div class="flex space-x-2"><Select v-model="value" :options="options" /><button type="button">Refresh</button></div>',
    });

    const wrapper = mount(Host, { attachTo: document.body });
    expect(wrapper.find(".flex").element.children).toHaveLength(2);
    wrapper.unmount();
  });

  test("keeps the selected label after the menu closes", async () => {
    const Host = defineComponent({
      components: { Select },
      setup() {
        const value = ref("today");
        const options = [
          { value: "today", label: "Today" },
          { value: "all", label: "All Time" },
        ];
        return { value, options };
      },
      template:
        '<Select v-model="value" :options="options" placeholder="Select period" />',
    });

    const wrapper = mount(Host, { attachTo: document.body });
    const trigger = wrapper.get('[role="combobox"]');
    expect(trigger.text()).toContain("Today");

    await trigger.trigger("click");
    await nextTick();
    await trigger.trigger("click");
    await nextTick();

    expect(trigger.text()).toContain("Today");
    expect(trigger.text()).not.toContain("Select period");
    wrapper.unmount();
  });
});
