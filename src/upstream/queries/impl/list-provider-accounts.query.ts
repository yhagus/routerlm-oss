import { Query } from "@nestjs/cqrs";
import type { ListedProviderAccount } from "../../models/provider-account.js";

/** Every Provider Account, by Provider and then by priority, with its Cooldown. */
export class ListProviderAccountsQuery extends Query<ListedProviderAccount[]> {}
