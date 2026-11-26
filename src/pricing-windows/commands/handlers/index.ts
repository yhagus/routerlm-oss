import { CreatePricingWindowHandler } from './create-pricing-window.handler';
import { DeletePricingWindowHandler } from './delete-pricing-window.handler';
import { ReplaceUpstreamModelPricingWindowsHandler } from './replace-upstream-model-pricing-windows.handler';
import { UpdatePricingWindowHandler } from './update-pricing-window.handler';

export const CommandHandlers = [
  CreatePricingWindowHandler,
  UpdatePricingWindowHandler,
  DeletePricingWindowHandler,
  ReplaceUpstreamModelPricingWindowsHandler,
];
