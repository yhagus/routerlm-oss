import { Query } from '@nestjs/cqrs';
import type { WaitingRequestCount } from '@/waiting-requests/models/waiting-requests';

export class CountWaitingRequestsQuery extends Query<WaitingRequestCount> {}
