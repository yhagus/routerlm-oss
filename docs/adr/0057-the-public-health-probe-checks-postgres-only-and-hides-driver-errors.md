# The public health probe checks Postgres only and hides driver errors

`HealthController` is public, for container and load balancer probes.

We decided that it answers 200 while Postgres answers and 503 otherwise, and does not check Redis: the API keeps serving while Redis is down (see the Redis ADR), so a Redis outage must not take the container out of rotation. When Postgres fails, `DatabaseHealthIndicator` reports a fixed message, because the driver's error names the database host and port and the probe is public. The ping has a 3 second timeout: long enough for a busy Postgres, short enough for a container health check.
