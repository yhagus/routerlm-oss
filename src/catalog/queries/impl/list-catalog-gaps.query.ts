import { Query } from "@nestjs/cqrs";
import type { CatalogGapReport } from "@/catalog/models/catalog-gap.js";

export class ListCatalogGapsQuery extends Query<CatalogGapReport> {}
