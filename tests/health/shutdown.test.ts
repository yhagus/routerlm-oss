import { BackgroundWork } from '@/libs/providers/background-work';
import { createTestApp } from '@tests/support/test-app';

const NEVER_SETTLES = new Promise<void>(() => {});
const BRIEF_WORK_MS = 50;
const LONGER_THAN_THE_SHUTDOWN_WAIT_MS = 15_000;

describe('Shutdown with background work in flight (e2e)', () => {
  it('waits for background work that finishes', async () => {
    const { app } = await createTestApp();
    let isFinished = false;
    app.get(BackgroundWork).run(
      new Promise<void>((resolve) => {
        setTimeout(() => {
          isFinished = true;
          resolve();
        }, BRIEF_WORK_MS);
      }),
    );

    await app.close();

    expect(isFinished).toBe(true);
  });

  it(
    'shuts down even when background work never finishes',
    async () => {
      const { app } = await createTestApp();
      app.get(BackgroundWork).run(NEVER_SETTLES);

      await expect(app.close()).resolves.toBeUndefined();
    },
    LONGER_THAN_THE_SHUTDOWN_WAIT_MS,
  );
});
