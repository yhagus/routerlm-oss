import { Public } from "@nestjs/authentication";
import { Controller, Get } from "@nestjs/common";
import { HealthCheck, type HealthCheckResult, HealthCheckService } from "@nestjs/terminus";
import { DatabaseHealthIndicator } from "./providers/database-health-indicator.js";

// Public, for container and load balancer probes. Redis is left out on purpose:
// the API keeps serving while Redis is down.
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  /** 200 while Postgres answers, 503 when it does not. */
  @Public()
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.isHealthy("database")]);
  }
}
