import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { HealthIndicatorService } from "@nestjs/terminus";
import { sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";

const DATABASE_PING_TIMEOUT_MS = 3_000;
const DATABASE_DOWN_MESSAGE = "Database unavailable";

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  isHealthy<const TKey extends string>(key: TKey) {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        await this.db.execute(sql`select 1`);
      })
      .withTimeout(DATABASE_PING_TIMEOUT_MS)
      .withFailureData({ message: DATABASE_DOWN_MESSAGE });
  }
}
