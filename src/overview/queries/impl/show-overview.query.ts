import { Query } from "@nestjs/cqrs";
import type { Overview, OverviewRange } from "@/overview/models/overview.js";

export class ShowOverviewQuery extends Query<Overview> {
  constructor(readonly range: OverviewRange) {
    super();
  }
}
