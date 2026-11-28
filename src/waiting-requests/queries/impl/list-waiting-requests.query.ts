import { Query } from '@nestjs/cqrs';
import type { WaitingRequestList } from '@/waiting-requests/models/waiting-requests';

export class ListWaitingRequestsQuery extends Query<WaitingRequestList> {}
