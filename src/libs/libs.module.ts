import { Global, Module } from "@nestjs/common";

// Shared injectables that belong to no module's domain are registered and exported here.
@Global()
@Module({ providers: [], exports: [] })
export class LibsModule {}
