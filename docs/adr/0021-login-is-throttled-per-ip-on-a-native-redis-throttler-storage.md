# Login is throttled per IP, on a native Redis storage for `@nestjs/throttler`

`POST /api/auth/login` had no limit, and each attempt costs one memory-hard scrypt hash. We decided:

- **Scope and key.** Only login is throttled: 10 attempts per minute per client IP. There is no per-email key. The Nest docs warn that anyone who knows an address could use it up and keep that User from signing in, and every User is a full operator.
- **`/v1` is not throttled by the gateway.** One office NAT can legitimately send a whole team's traffic, so rate limiting `/v1` is the reverse proxy's job, and the deploy docs say so.
- **Package.** `@nestjs/throttler` (first-party, documented on docs.nestjs.com under Security > Rate limiting), registered in `LibsModule`.
- **Client IP.** Behind a proxy the IP comes from a deploy-time `TRUST_PROXY` env setting, off by default, so an unproxied deployment can't be fooled by a forged `X-Forwarded-For`.
- **Storage.** A native `ThrottlerStorage` (the interface `@nestjs/throttler` exports) on the existing `RedisConnection` in `src/libs/`, with an atomic increment script. If Redis is down it fails open, so login keeps working.

## Considered Options

- The built-in in-memory storage. Rejected: with several replicas the real limit is multiplied by their number, and it resets on every deploy.
- `@nest-lab/throttler-storage-redis`, the Redis storage the docs mention. Rejected: its peer dependencies stop at Nest 11, and we run Nest 12. This is the approved exception to ADR 0001; revisit it when the package supports Nest 12.
- A per-email throttler. Rejected for the lockout reason above.

## Consequences

- With `TRUST_PROXY` unset behind a proxy, every client shares the proxy's IP, so 10 logins a minute apply to everyone together. The deploy docs call this out.
- Failing open means a Redis outage removes the login limit; the scrypt cost itself is unchanged.
