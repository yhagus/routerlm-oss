import { Module } from "@nestjs/common";
import { CommandHandlers } from "./commands/handlers/index.js";

/** Seeding the Catalog's Providers and Upstream Models, for the processes that boot a database. */
@Module({ providers: [...CommandHandlers] })
export class CatalogModule {}
