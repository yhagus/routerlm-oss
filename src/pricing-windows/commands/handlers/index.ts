import { CreatePricingWindowHandler } from "./create-pricing-window.handler.js";
import { DeletePricingWindowHandler } from "./delete-pricing-window.handler.js";
import { ReplaceUpstreamModelPricingWindowsHandler } from "./replace-upstream-model-pricing-windows.handler.js";
import { UpdatePricingWindowHandler } from "./update-pricing-window.handler.js";

export const CommandHandlers = [
  CreatePricingWindowHandler,
  UpdatePricingWindowHandler,
  DeletePricingWindowHandler,
  ReplaceUpstreamModelPricingWindowsHandler,
];
