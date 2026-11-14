import { CreateFirstUserHandler } from "./create-first-user.handler.js";
import { CreateUserHandler } from "./create-user.handler.js";
import { DeleteUserHandler } from "./delete-user.handler.js";
import { ResetPasswordHandler } from "./reset-password.handler.js";

export const CommandHandlers = [
  CreateFirstUserHandler,
  CreateUserHandler,
  ResetPasswordHandler,
  DeleteUserHandler,
];
