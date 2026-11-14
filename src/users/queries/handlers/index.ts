import { FindUserByCredentialsHandler } from "./find-user-by-credentials.handler.js";
import { IsSetupRequiredHandler } from "./is-setup-required.handler.js";
import { ListUsersHandler } from "./list-users.handler.js";

export const QueryHandlers = [
  IsSetupRequiredHandler,
  ListUsersHandler,
  FindUserByCredentialsHandler,
];
