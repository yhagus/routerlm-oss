import { Query } from "@nestjs/cqrs";
import type { Overview, OverviewRange } from "@/overview/models/overview.js";

/** Gateway traffic over one range, ending now, cut into buckets. */
export class ShowOverviewQuery extends Query<Overview> {
  constructor(readonly range: OverviewRange) {
    super();
  }
}
