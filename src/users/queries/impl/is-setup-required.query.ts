import { Query } from "@nestjs/cqrs";

/** Whether first-run setup is still open: true until the first User exists. */
export class IsSetupRequiredQuery extends Query<boolean> {}
