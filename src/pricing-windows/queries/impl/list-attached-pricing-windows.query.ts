import { Query } from "@nestjs/cqrs";
import type { AttachedPricingWindow } from "@/pricing-windows/models/upstream-model-pricing-windows.js";

/** Every Upstream Model's Pricing Windows with their Window Prices, in its order, keyed by its row id. */
export class ListAttachedPricingWindowsQuery extends Query<Map<string, AttachedPricingWindow[]>> {}
