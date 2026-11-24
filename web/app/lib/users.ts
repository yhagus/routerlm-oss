export interface User {
  id: string;
  email: string;
  createdById: string | null;
  createdAt: string;
}

export const MIN_PASSWORD_LENGTH = 8;
