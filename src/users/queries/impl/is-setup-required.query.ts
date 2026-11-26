import { Query } from '@nestjs/cqrs';

export class IsSetupRequiredQuery extends Query<boolean> {}
