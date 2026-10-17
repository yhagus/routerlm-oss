export function providerLogo(provider: string | undefined): string | undefined {
  if (!provider) return undefined;
  const id = provider.toLowerCase().replaceAll("_", "-");
  const aliases: Record<string, string> = {
    "alims-intl": "alicode-intl",
    "codebuddy-intl-cli": "codebuddy-intl",
    explabs: "experiential-labs",
    glm: "glm",
    opencode: "opencode",
    tokenharbor: "tokenharbor",
  };
  const file = aliases[id] || id;
  if (id === "bitdeer") return "/providers/bitdeer.svg";
  if (id === "deepseek-harness") return "/providers/deepseek-harness.svg";
  if (file === "experiential-labs") return "/providers/experiential-labs.svg";
  return file === "tokenharbor"
    ? "/providers/tokenharbor.svg"
    : `/providers/${file}.png`;
}
