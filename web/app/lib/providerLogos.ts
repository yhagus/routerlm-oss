export interface ProviderLogoMark {
  label: string;
  svg: string;
}

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
