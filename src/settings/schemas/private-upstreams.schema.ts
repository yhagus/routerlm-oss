import { z } from "zod";
import { settingValueSchema } from "@/settings/models/setting-definitions";

export const newPrivateUpstreamsSchema = z.object({
  allowed: settingValueSchema("allowPrivateUpstreams"),
});
export type NewPrivateUpstreams = z.infer<typeof newPrivateUpstreamsSchema>;
