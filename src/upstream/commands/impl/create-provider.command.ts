import { Command } from "@nestjs/cqrs";
import type { Provider } from "../../models/provider.js";
import type { NewProvider } from "../../schemas/upstream.schema.js";

export class CreateProviderCommand extends Command<Provider> {
  constructor(readonly newProvider: NewProvider) {
    super();
  }
}
