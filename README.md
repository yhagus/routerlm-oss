<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

NestJS application using Bun, the Node adapter, Drizzle on PostgreSQL, and the Oxc toolchain.

## Project setup

```bash
$ bun install
```

## Compile and run the project

```bash
# development
$ bun run start

# watch mode
$ bun run start:dev

# production mode
$ bun run start:prod
```

## Run tests

```bash
# everything CI checks without services: lint, format, typecheck
# (in web/, `bun run check` runs lint, format and nuxi typecheck)
$ bun run check

# feature tests (tests/<feature>/*.test.ts): they create, migrate and truncate
# their own database, TEST_DATABASE_URL (default routerlm_test on the compose
# Postgres), and need Redis at REDIS_URL
$ bun run test

# feature tests against throwaway Postgres and Redis containers
# (docker-compose.test.yml, host ports 55432 and 56379), removed afterwards;
# the dev stack can keep running
$ bun run test:docker

# test coverage
$ bun run test:cov
```

## Development setup

Create `.env` with a fresh encryption key, then start the stack:

```bash
$ sed "s|^ENCRYPTION_KEY=$|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env.example > .env
$ docker compose up -d
```

Every other value has a development default in `docker-compose.yml`; override
any of them in `.env` (ports, Postgres credentials, Error Capture retention; see
`.env.example`). On each `up`, the one-shot `migrate` service applies pending
migrations and seeds the Catalog before `backend` and `worker` start. Then open
http://localhost:3001 to create the first User.

## Encryption key

Provider Account keys are encrypted at rest with `ENCRYPTION_KEY` (32 random
bytes in base64). The backend and worker refuse to start without it, and
`docker compose` refuses to start with a message saying how to generate one.
Back it up: stored Provider Account keys can't be decrypted without it.

## Database

The backend uses PostgreSQL through [Drizzle ORM](https://orm.drizzle.team).
`docker compose up -d` starts a `db` service (Postgres 18) and points the
backend at it. To run the backend on the host instead, copy `.env.example` to
`.env`; it targets the compose database on `localhost:5432`.

The schema lives in `src/db/schemas/`. After changing it, generate a migration
into `drizzle/` and apply it:

```bash
$ docker compose exec backend bun run db:generate
$ docker compose exec backend bun run db:migrate
```

`bun run db:push` syncs the schema without a migration (local prototyping only),
and `bun run db:studio` opens Drizzle Studio.

## Catalog

The Catalog is the Providers and Upstream Models that ship with the gateway. It
lives in `src/catalog/data/`, one JSON file per Provider. `docker compose
up` seeds it automatically; to run the seeder by hand:

```bash
$ docker compose exec backend bun run db:seed
```

The seeder only creates rows that are missing. It never changes a Provider or
Upstream Model that already exists, so edits made in the dashboard survive, and
it never creates Provider Accounts, Models or Routes. Running it again is safe.

To update the Catalog, edit the Provider's file:

- Take model ids, Capabilities, context sizes and prices (USD per million
  tokens) from the Provider's own documentation and pricing pages.
- Put those page URLs and the date you read them in the entry's `source`.
- Use `null` for a value the Provider doesn't publish. Never estimate one.
- The file shape and the allowed `quirks` keys are defined in
  `src/catalog/schemas/catalog.schema.ts`. `bun run db:seed` checks every file against it
  and names the entry at fault; `tests/catalog/` runs it on the shipped files.

Because existing rows are never overwritten, a changed price reaches a database
that was already seeded only when an operator edits it in the dashboard.

## Queue and worker

Background jobs go through [BullMQ](https://docs.bullmq.io) on Redis, set by
`REDIS_URL`. The backend only enqueues jobs; a separate worker process
(`src/worker.ts`, a Nest application context without HTTP) runs them.
`docker compose up -d` starts a `redis` service and a `worker` service that
restarts when a file under `src/` changes. If Redis is unreachable, the backend
logs the failed enqueue and keeps serving requests.

```bash
# worker on the host (watch mode, production)
$ bun run worker:dev
$ bun run worker:prod
```

`bun run test` needs Redis at `REDIS_URL` (default `redis://localhost:6379`)
for the worker test.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It installs `@nestjs/observe`, wires it into `AppModule` and `main.ts`, and writes the app key and secret into `.env`, which every `nest start` script (`start`, `start:dev`, `start:debug`) then loads. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand:

```bash
$ bun install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/sdk) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
