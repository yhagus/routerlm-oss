import type { INestApplicationContext } from "@nestjs/common";
import { SettingsStore } from "@/settings/providers/settings-store.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";

/**
 * Turns the Allow private upstreams Setting on or off, as the dashboard does:
 * it saves the Setting and reloads the snapshot, which hands it to the
 * Provider URL checks. The fake upstream listens on localhost over http, so
 * `createTestApp` turns it on (ADR 0019).
 */
export async function allowPrivateUpstreams(
  app: INestApplicationContext,
  allowed: boolean,
): Promise<void> {
  await app.get(SettingsStore).write("allowPrivateUpstreams", allowed);
  await app.get(SnapshotService).changed();
}
