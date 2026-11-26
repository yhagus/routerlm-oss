import { Get } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator";
import type { CatalogGapReport } from "./models/catalog-gap";
import { ListCatalogGapsQuery } from "./queries/impl/list-catalog-gaps.query";

@DashboardController("catalog")
export class CatalogGapsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("gaps")
  listCatalogGaps(): Promise<CatalogGapReport> {
    return this.queryBus.execute(new ListCatalogGapsQuery());
  }
}
