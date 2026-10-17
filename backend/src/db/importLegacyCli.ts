import { loadRuntimeConfig } from "../config";
import { createRuntime } from "../runtime";
import { importLegacyDatabase } from "./importLegacy";

const config = loadRuntimeConfig();
if (!config.legacyDatabasePath) throw new Error("LEGACY_DATABASE_PATH is required");
const runtime = await createRuntime(config);
try {
  console.log(JSON.stringify(await importLegacyDatabase(config.legacyDatabasePath, runtime.sqlite), null, 2));
} finally {
  runtime.close();
}
