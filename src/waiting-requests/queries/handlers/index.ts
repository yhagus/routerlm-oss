import { CountWaitingRequestsHandler } from './count-waiting-requests.handler';
import { ListWaitingRequestsHandler } from './list-waiting-requests.handler';

export const QueryHandlers = [ListWaitingRequestsHandler, CountWaitingRequestsHandler];
