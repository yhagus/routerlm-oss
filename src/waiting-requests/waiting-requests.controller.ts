import { Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { DashboardController } from '@/auth/decorators/dashboard-controller.decorator';
import type { WaitingRequestCount, WaitingRequestList } from './models/waiting-requests';
import { CountWaitingRequestsQuery } from './queries/impl/count-waiting-requests.query';
import { ListWaitingRequestsQuery } from './queries/impl/list-waiting-requests.query';

@DashboardController('waiting-requests')
export class WaitingRequestsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  listWaitingRequests(): Promise<WaitingRequestList> {
    return this.queryBus.execute(new ListWaitingRequestsQuery());
  }

  @Get('count')
  countWaitingRequests(): Promise<WaitingRequestCount> {
    return this.queryBus.execute(new CountWaitingRequestsQuery());
  }
}
