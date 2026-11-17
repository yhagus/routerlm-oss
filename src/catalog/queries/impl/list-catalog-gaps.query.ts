import { Query } from "@nestjs/cqrs";
import type { CatalogGapReport } from "../../models/catalog-gap.js";

/** The Catalog Gaps among the newest models models.dev lists for each Provider. */
export class ListCatalogGapsQuery extends Query<CatalogGapReport> {}
