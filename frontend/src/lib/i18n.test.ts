import { afterEach, describe, expect, test, vi } from "vitest";
import { reloadTranslations } from "./i18n";

function useLocale(locale: string, table: Record<string, string>) {
  document.cookie = `locale=${locale}; path=/`;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(table), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "locale=en; path=/";
  document.body.innerHTML = "";
});

describe("reloadTranslations", () => {
  test("keeps a placeholder that the framework changed after translation", async () => {
    useLocale("id", { "Message model-a": "Pesan model-a" });
    const input = document.createElement("textarea");
    input.setAttribute("placeholder", "Message No model selected");
    document.body.append(input);
    await reloadTranslations();

    // Vue writes the new placeholder once the model list loads.
    input.setAttribute("placeholder", "Message model-a");
    await reloadTranslations();

    expect(input.getAttribute("placeholder")).toBe("Pesan model-a");
  });

  test("keeps text that the framework changed after translation", async () => {
    useLocale("id", { Ready: "Siap" });
    const label = document.createElement("span");
    label.textContent = "Ready";
    document.body.append(label);
    await reloadTranslations();
    expect(label.textContent).toBe("Siap");

    label.firstChild!.nodeValue = "Streaming";
    await reloadTranslations();

    expect(label.textContent).toBe("Streaming");
  });

  test("restores the English source when the locale switches back", async () => {
    useLocale("id", { Save: "Simpan" });
    const button = document.createElement("button");
    button.setAttribute("title", "Save");
    button.textContent = "Save";
    document.body.append(button);
    await reloadTranslations();
    expect(button.textContent).toBe("Simpan");

    document.cookie = "locale=en; path=/";
    await reloadTranslations();

    expect(button.textContent).toBe("Save");
    expect(button.getAttribute("title")).toBe("Save");
  });
});
