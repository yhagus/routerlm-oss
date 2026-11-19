import { BadRequestException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { type ModelKind, upstreamModels } from "@/db/schemas/index.js";

/**
 * Refuses a Route from the Model to an Upstream Model of another Kind, naming
 * both Kinds (GLOSSARY "Model Kind"), and a Route to an Upstream Model that
 * doesn't exist.
 */
export async function assertRouteKindFits(
  db: Database,
  model: { name: string; kind: ModelKind },
  upstreamModelRowId: string,
): Promise<void> {
  const [upstreamModel] = await db
    .select({ upstreamModelId: upstreamModels.upstreamModelId, kind: upstreamModels.kind })
    .from(upstreamModels)
    .where(eq(upstreamModels.id, upstreamModelRowId));
  if (!upstreamModel) {
    throw new NotFoundException("Upstream Model not found");
  }
  if (upstreamModel.kind !== model.kind) {
    throw new BadRequestException(
      `The Upstream Model "${upstreamModel.upstreamModelId}" has the Kind ${upstreamModel.kind}, ` +
        `but the Model "${model.name}" has the Kind ${model.kind}`,
    );
  }
}
