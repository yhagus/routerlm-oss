export const DEMO_DATABASE_SUFFIX = "_demo";

export function assertDemoDatabase(databaseUrl: string | undefined): void {
  const databaseName = databaseUrl ? databaseNameOf(databaseUrl) : "";
  if (!databaseName.endsWith(DEMO_DATABASE_SUFFIX)) {
    throw new Error(
      `db:seed:demo truncates every table, so the database name in DATABASE_URL must end in ${DEMO_DATABASE_SUFFIX} (got "${databaseName}")`,
    );
  }
}

function databaseNameOf(databaseUrl: string): string {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    return "";
  }
}
