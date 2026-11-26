import { CreateCustomerApiKeyHandler } from "./create-customer-api-key.handler";
import { RevokeCustomerApiKeyHandler } from "./revoke-customer-api-key.handler";
import { RotateCustomerApiKeyHandler } from "./rotate-customer-api-key.handler";
import { UpdateCustomerApiKeyHandler } from "./update-customer-api-key.handler";

export const CommandHandlers = [
  CreateCustomerApiKeyHandler,
  UpdateCustomerApiKeyHandler,
  RotateCustomerApiKeyHandler,
  RevokeCustomerApiKeyHandler,
];
