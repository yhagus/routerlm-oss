import { Query } from "@nestjs/cqrs";
import type { PricingWindowSummary } from "@/pricing-windows/models/pricing-window";

export class ListPricingWindowsQuery extends Query<PricingWindowSummary[]> {}
