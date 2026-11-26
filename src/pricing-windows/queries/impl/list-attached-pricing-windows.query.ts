import { Query } from "@nestjs/cqrs";
import type { AttachedPricingWindow } from "@/pricing-windows/models/upstream-model-pricing-windows";

export class ListAttachedPricingWindowsQuery extends Query<Map<string, AttachedPricingWindow[]>> {}
