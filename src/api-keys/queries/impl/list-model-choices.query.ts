import { Query } from "@nestjs/cqrs";
import type { ModelChoice } from "@/api-keys/models/api-key.js";

/** The Models a new key can be restricted to. */
export class ListModelChoicesQuery extends Query<ModelChoice[]> {}
