import { Query } from "@nestjs/cqrs";
import type { Provider } from "@/upstream/models/provider.js";

export class ListProvidersQuery extends Query<Provider[]> {}
