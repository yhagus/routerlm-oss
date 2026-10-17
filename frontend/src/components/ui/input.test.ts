import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { describe, expect, test } from "vitest";
import Input from "./input.vue";

describe("Input", () => {
  test("forwards native input changes through v-model", async () => {
    const Host = defineComponent({
      components: { Input },
      setup() {
        const value = ref("");
        return { value };
      },
      template: '<Input v-model="value" />',
    });

    const wrapper = mount(Host);
    await wrapper.find("input").setValue("123456");

    expect((wrapper.vm as { value: string }).value).toBe("123456");
  });
});
