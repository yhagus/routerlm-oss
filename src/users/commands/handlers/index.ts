import { CreateFirstUserHandler } from './create-first-user.handler';
import { CreateUserHandler } from './create-user.handler';
import { DeleteUserHandler } from './delete-user.handler';
import { ResetPasswordHandler } from './reset-password.handler';

export const CommandHandlers = [
  CreateFirstUserHandler,
  CreateUserHandler,
  ResetPasswordHandler,
  DeleteUserHandler,
];
