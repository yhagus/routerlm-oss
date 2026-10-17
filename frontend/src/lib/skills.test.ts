import { describe, expect, test } from "vitest";
import { SKILLS } from "./skills";

describe("Skills icon mappings", () => {
  test("uses loaded Material Symbols for audio and vector skills", () => {
    expect(SKILLS.find((skill) => skill.id === "lobakai-tts")?.icon).toBe(
      "record_voice_over",
    );
    expect(
      SKILLS.find((skill) => skill.id === "lobakai-embeddings")?.icon,
    ).toBe("data_array");
  });
});
