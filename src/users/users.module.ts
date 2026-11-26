import { Module } from "@nestjs/common";
import { CommandHandlers } from "./commands/handlers";
import { QueryHandlers } from "./queries/handlers";
import { UsersController } from "./users.controller";

@Module({
  controllers: [UsersController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
