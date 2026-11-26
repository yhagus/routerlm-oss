export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';

export function hasPostgresErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const driverError = error.cause ?? error;
  return (
    typeof driverError === 'object' &&
    driverError !== null &&
    'code' in driverError &&
    driverError.code === code
  );
}
