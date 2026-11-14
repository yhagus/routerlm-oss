import { Query } from "@nestjs/cqrs";
import type { ApiKeySummary } from "../../models/api-key.js";

/** Every API Key, newest first. */
export class ListApiKeysQuery extends Query<ApiKeySummary[]> {}
