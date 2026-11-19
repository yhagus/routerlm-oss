import { z } from "zod";
import { settingValueSchema } from "../models/setting-definitions.js";

export const newPrivateUpstreamsSchema = z.object({
  allowed: settingValueSchema("allowPrivateUpstreams"),
});
export type NewPrivateUpstreams = z.infer<typeof newPrivateUpstreamsSchema>;
