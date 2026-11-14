import { Query } from "@nestjs/cqrs";
import type { Provider } from "../../models/provider.js";

/** Every Provider, by name. */
export class ListProvidersQuery extends Query<Provider[]> {}
