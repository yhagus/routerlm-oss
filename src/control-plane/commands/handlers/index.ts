import { CreateCustomerApiKeyHandler } from "./create-customer-api-key.handler.js";
import { RevokeCustomerApiKeyHandler } from "./revoke-customer-api-key.handler.js";
import { RotateCustomerApiKeyHandler } from "./rotate-customer-api-key.handler.js";
import { UpdateCustomerApiKeyHandler } from "./update-customer-api-key.handler.js";

export const CommandHandlers = [
  CreateCustomerApiKeyHandler,
  UpdateCustomerApiKeyHandler,
  RotateCustomerApiKeyHandler,
  RevokeCustomerApiKeyHandler,
];
