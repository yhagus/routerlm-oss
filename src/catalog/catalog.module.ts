import { Module } from "@nestjs/common";
import { CommandHandlers } from "./commands/handlers/index.js";

@Module({ providers: [...CommandHandlers] })
export class CatalogModule {}
