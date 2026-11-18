import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { HealthIndicatorService } from "@nestjs/terminus";
import { sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";

// Long enough for a busy Postgres, short enough for a container health check.
const DATABASE_PING_TIMEOUT_MS = 3_000;
const DATABASE_DOWN_MESSAGE = "Database unavailable";

/** Up when Postgres answers a trivial query through the app's Drizzle client. */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  isHealthy<const TKey extends string>(key: TKey) {
    return (
      this.healthIndicatorService
        .check(key)
        .attempt(async () => {
          await this.db.execute(sql`select 1`);
        })
        .withTimeout(DATABASE_PING_TIMEOUT_MS)
        // The driver's error names the database host and port; a public probe must not see it.
        .withFailureData({ message: DATABASE_DOWN_MESSAGE })
    );
  }
}
