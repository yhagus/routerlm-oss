import { Command } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import type { IssuedCustomerApiKey } from "../../models/customer-api-key.js";

/** Replaces one of the Integration's keys with a new one, keeping its history (RotateKey). */
export class RotateCustomerApiKeyCommand extends Command<IssuedCustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly id: string,
  ) {
    super();
  }
}
