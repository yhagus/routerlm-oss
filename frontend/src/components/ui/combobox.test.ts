import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { afterEach, describe, expect, test } from "vitest";
import Combobox from "./combobox.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Combobox", () => {
  test("opens suggestions on focus and accepts a custom value", async () => {
    const Host = defineComponent({
      components: { Combobox },
      setup() {
        const value = ref("team-a");
        const options = [
          { value: "team-a", label: "Team A" },
          { value: "team-b", label: "Team B" },
        ];
        return { value, options };
      },
      template: '<Combobox v-model="value" :options="options" allow-custom />',
    });

    const wrapper = mount(Host, { attachTo: document.body });
    const input = wrapper.get("input");
    await input.trigger("focus");
    await nextTick();

    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Team A");
    await input.setValue("new-team");

    expect((wrapper.vm as { value: string }).value).toBe("new-team");
    wrapper.unmount();
  });
});
