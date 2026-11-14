import { z } from "zod";
import { OVERVIEW_RANGES } from "../models/overview.js";

export const overviewQuerySchema = z.object({
  range: z.enum(OVERVIEW_RANGES).default("24h"),
});
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
