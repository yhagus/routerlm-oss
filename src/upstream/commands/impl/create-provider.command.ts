import { Command } from "@nestjs/cqrs";
import type { Provider } from "@/upstream/models/provider";
import type { NewProvider } from "@/upstream/schemas/upstream.schema";

export class CreateProviderCommand extends Command<Provider> {
  constructor(readonly newProvider: NewProvider) {
    super();
  }
}
