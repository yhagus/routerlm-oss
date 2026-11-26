import type { IEvent } from '@nestjs/cqrs';

export class ProviderAccountCreatedEvent implements IEvent {
  constructor(
    readonly providerAccountId: string,
    readonly providerId: string,
  ) {}
}
