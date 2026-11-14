import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { type CatalogProvider, catalogProviderSchema } from "../schemas/catalog.schema.js";

/** The Catalog files that ship with the gateway, one JSON file per Provider. */
export const CATALOG_DIRECTORY = fileURLToPath(new URL("../data", import.meta.url));

/**
 * Reads and validates every `*.json` file in `directory`. Throws on the first
 * invalid file, naming the file and the entry at fault.
 */
export async function loadCatalog(directory: string): Promise<CatalogProvider[]> {
  const fileNames = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const providers: CatalogProvider[] = [];

  for (const fileName of fileNames) {
    const provider = parseProviderFile(fileName, await readFile(join(directory, fileName), "utf8"));
    if (providers.some((loaded) => loaded.slug === provider.slug)) {
      throw new Error(
        `Catalog ${fileName}: slug "${provider.slug}" is already used by another file`,
      );
    }
    providers.push(provider);
  }

  return providers;
}

function parseProviderFile(fileName: string, contents: string): CatalogProvider {
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Catalog ${fileName}: not valid JSON`, { cause: error });
  }

  const result = catalogProviderSchema.safeParse(json);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => describeIssue(json, issue));
    throw new Error(`Catalog ${fileName}: ${problems.join("; ")}`);
  }

  const modelIds = result.data.upstreamModels.map((model) => model.upstreamModelId);
  const duplicateId = modelIds.find((id, index) => modelIds.indexOf(id) !== index);
  if (duplicateId !== undefined) {
    throw new Error(`Catalog ${fileName}: Upstream Model "${duplicateId}" is listed twice`);
  }

  return result.data;
}

/** Turns `["upstreamModels", 2, "source"]` into `upstreamModels[2] (gpt-x).source`. */
function describeIssue(json: unknown, issue: z.core.$ZodIssue): string {
  const [section, index, ...rest] = issue.path;
  if (section !== "upstreamModels" || typeof index !== "number") {
    return `${issue.path.join(".") || "(file)"}: ${issue.message}`;
  }

  const modelId = readUpstreamModelId(json, index);
  const entry = `upstreamModels[${index}]${modelId === undefined ? "" : ` (${modelId})`}`;
  return [entry, ...rest].join(".") + `: ${issue.message}`;
}

function readUpstreamModelId(json: unknown, index: number): string | undefined {
  if (typeof json !== "object" || json === null || !("upstreamModels" in json)) return undefined;
  const models = json.upstreamModels;
  if (!Array.isArray(models)) return undefined;
  const model: unknown = models[index];
  if (typeof model !== "object" || model === null || !("upstreamModelId" in model))
    return undefined;
  return typeof model.upstreamModelId === "string" ? model.upstreamModelId : undefined;
}
