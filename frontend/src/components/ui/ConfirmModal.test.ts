import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmModal from "./ConfirmModal.vue";

describe("ConfirmModal", () => {
  it("renders the title in the modal header", () => {
    const wrapper = mount(ConfirmModal, {
      props: {
        open: true,
        title: "Delete connection",
        message: "Delete this connection?",
      },
    });

    expect(wrapper.find("h2").text()).toBe("Delete connection");
    expect(wrapper.find("h3").exists()).toBe(false);
  });
});
