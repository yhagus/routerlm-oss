import { Command } from "@nestjs/cqrs";
import type { Provider } from "@/upstream/models/provider.js";
import type { NewProvider } from "@/upstream/schemas/upstream.schema.js";

export class CreateProviderCommand extends Command<Provider> {
  constructor(readonly newProvider: NewProvider) {
    super();
  }
}
