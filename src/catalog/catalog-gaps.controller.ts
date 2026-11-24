import { Get } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import type { CatalogGapReport } from "./models/catalog-gap.js";
import { ListCatalogGapsQuery } from "./queries/impl/list-catalog-gaps.query.js";

@DashboardController("catalog")
export class CatalogGapsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("gaps")
  listCatalogGaps(): Promise<CatalogGapReport> {
    return this.queryBus.execute(new ListCatalogGapsQuery());
  }
}
