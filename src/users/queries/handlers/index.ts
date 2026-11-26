import { FindUserByCredentialsHandler } from "./find-user-by-credentials.handler";
import { IsSetupRequiredHandler } from "./is-setup-required.handler";
import { ListUsersHandler } from "./list-users.handler";

export const QueryHandlers = [
  IsSetupRequiredHandler,
  ListUsersHandler,
  FindUserByCredentialsHandler,
];
