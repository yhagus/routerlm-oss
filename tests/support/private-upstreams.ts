import type { INestApplicationContext } from '@nestjs/common';
import { SettingsStore } from '@/settings/providers/settings-store';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';

export async function allowPrivateUpstreams(
  app: INestApplicationContext,
  allowed: boolean,
): Promise<void> {
  await app.get(SettingsStore).write('allowPrivateUpstreams', allowed);
  await app.get(SnapshotService).changed();
}
