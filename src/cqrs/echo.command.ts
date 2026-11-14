import { Command } from "@nestjs/cqrs";

export class EchoCommand extends Command<string> {
  constructor(public readonly text: string) {
    super();
  }
}
