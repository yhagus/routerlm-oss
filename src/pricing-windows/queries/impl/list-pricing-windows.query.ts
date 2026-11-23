import { Query } from "@nestjs/cqrs";
import type { PricingWindowSummary } from "@/pricing-windows/models/pricing-window.js";

/** Every Pricing Window, by name. */
export class ListPricingWindowsQuery extends Query<PricingWindowSummary[]> {}
