import { type BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { settleBackgroundWork } from '@/libs/models/background-work';

@Injectable()
export class BackgroundWorkShutdown implements BeforeApplicationShutdown {
  async beforeApplicationShutdown(): Promise<void> {
    await settleBackgroundWork();
  }
}
