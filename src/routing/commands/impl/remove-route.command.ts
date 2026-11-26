import { Command } from '@nestjs/cqrs';

export class RemoveRouteCommand extends Command<void> {
  constructor(
    readonly modelId: string,
    readonly routeId: string,
  ) {
    super();
  }
}
