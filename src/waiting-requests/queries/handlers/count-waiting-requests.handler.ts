import { Logger } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { WaitingRequestCount } from '@/waiting-requests/models/waiting-requests';
import { WaitingLines } from '@/waiting-requests/providers/waiting-lines';
import { CountWaitingRequestsQuery } from '@/waiting-requests/queries/impl/count-waiting-requests.query';

@QueryHandler(CountWaitingRequestsQuery)
export class CountWaitingRequestsHandler implements IQueryHandler<CountWaitingRequestsQuery> {
  private readonly logger = new Logger(CountWaitingRequestsHandler.name);

  constructor(private readonly waitingLines: WaitingLines) {}

  async execute(): Promise<WaitingRequestCount> {
    try {
      return { available: true, count: await this.waitingLines.countWaiters() };
    } catch (error) {
      this.logger.warn(`Waiting Requests not counted: ${String(error)}`);
      return { available: false, count: 0 };
    }
  }
}
