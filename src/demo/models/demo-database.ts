/** The database name every demo database ends in, so a seed never wipes a real install. */
export const DEMO_DATABASE_SUFFIX = "_demo";

/** Throws unless `databaseUrl` names a database ending in `_demo`: the demo seed truncates every table. */
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
