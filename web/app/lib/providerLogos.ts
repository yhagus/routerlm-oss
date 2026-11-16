// The logo set a Provider's `logo` key points into. Each mark is a file in
// assets/provider-logos named after its key, so adding a logo means dropping
// in a file. Vendored files, so rendering them with `v-html` shows nothing untrusted.

export interface ProviderLogoMark {
  label: string;
  svg: string;
}

/**
 * Names for marks whose file title isn't how the dashboard writes the company:
 * a product name (xAI's file is titled "Grok") or other casing.
 */
const LABEL_OVERRIDES: Record<string, string> = {
  alibabacloud: "Alibaba Cloud",
  bedrock: "Amazon Bedrock",
  huggingface: "Hugging Face",
  minimax: "MiniMax",
  moonshot: "Moonshot AI",
  nvidia: "NVIDIA",
  together: "Together AI",
  xai: "xAI",
  xiaomimimo: "Xiaomi MiMo",
  yi: "01.AI Yi",
};

const SVG_FILES: Record<string, string> = import.meta.glob<string>(
  "../assets/provider-logos/*.svg",
  { query: "?raw", import: "default", eager: true },
);

function keyOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1, -".svg".length);
}

function titleOf(svg: string): string | undefined {
  return /<title>([^<]+)<\/title>/.exec(svg)?.[1];
}

export const PROVIDER_LOGOS: ReadonlyMap<string, ProviderLogoMark> = new Map(
  Object.entries(SVG_FILES)
    .map(([path, svg]): [string, ProviderLogoMark] => {
      const key = keyOf(path);
      return [key, { label: LABEL_OVERRIDES[key] ?? titleOf(svg) ?? key, svg }];
    })
    .sort(([, a], [, b]) => a.label.localeCompare(b.label)),
);
