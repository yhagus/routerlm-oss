import { Query } from '@nestjs/cqrs';
import type { CatalogGapReport } from '@/catalog/models/catalog-gap';

export class ListCatalogGapsQuery extends Query<CatalogGapReport> {}
