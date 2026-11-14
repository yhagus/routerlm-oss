/** A User as the dashboard API returns it. */
export interface User {
  id: string;
  email: string;
  /** Null for the User created by setup, or when their creator was deleted. */
  createdById: string | null;
  createdAt: string;
}

/** Shortest password the backend accepts. */
export const MIN_PASSWORD_LENGTH = 8;
