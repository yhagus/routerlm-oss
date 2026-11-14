import { CommandHandler, ICommandHandler } from "@nestjs/cqrs";
import { EchoCommand } from "./echo.command.js";

@CommandHandler(EchoCommand)
export class EchoHandler implements ICommandHandler<EchoCommand> {
  async execute(command: EchoCommand): Promise<string> {
    return command.text;
  }
}
