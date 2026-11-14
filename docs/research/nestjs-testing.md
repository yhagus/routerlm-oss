# NestJS testing research

Research date: 2026-11-14. Sources are limited to the official NestJS documentation and the official `nestjs/docs.nestjs.com` repository.

## Current CLI defaults

- `nest new` asks which module system to use. ESM is the default and scaffolds Vitest; CommonJS scaffolds Jest. Both variants use oxlint in current CLI documentation. Existing applications can keep their current runner. Sources: [First steps](https://docs.nestjs.com/first-steps), [CLI `nest new`](https://docs.nestjs.com/cli/usages), and the [migration guide](https://docs.nestjs.com/migration).
- The migration guide describes this as a generated-project default: Nest's testing utilities remain unchanged and `@nestjs/testing` is test-runner agnostic. Source: [Migration guide](https://docs.nestjs.com/migration).
- The official Vitest recipe says new ESM projects are already configured for Vitest, and documents a root `vitest.config.ts` plus a separate E2E config (for example, `vitest.config.e2e.ts`) with an `include` glob. Source: [SWC/Vitest recipe](https://docs.nestjs.com/recipes/swc).

## Nest testing APIs

- The testing fundamentals index is [Testing](https://docs.nestjs.com/fundamentals/testing); its unit-testing guidance is maintained in the official docs source at [`content/fundamentals/unit-testing.md`](https://github.com/nestjs/docs.nestjs.com/blob/master/content/fundamentals/unit-testing.md).
- `Test.createTestingModule()` accepts the same module metadata shape used by `@Module()`. Calling `compile()` bootstraps the module and returns a `TestingModule`; `moduleRef.get()` retrieves static provider/controller instances. Source: [Unit testing](https://docs.nestjs.com/fundamentals/unit-testing) (official source: [`content/fundamentals/unit-testing.md`](https://github.com/nestjs/docs.nestjs.com/blob/master/content/fundamentals/unit-testing.md)).
- For HTTP E2E tests, the official example creates an app with `moduleRef.createNestApplication()`, awaits `app.init()`, exercises the HTTP server with Supertest, and closes the app in `afterAll`. Source: [Unit testing](https://docs.nestjs.com/fundamentals/unit-testing).

## Package scripts and configuration

- Nest recommends package scripts for build/start commands so the project uses the locally installed CLI and its dependency versions. The documented baseline is `build: nest build`, `start: nest start`, `start:dev: nest start --watch`, and `start:debug: nest start --debug --watch`. Source: [CLI scripts](https://docs.nestjs.com/cli/scripts).
- The official Vitest recipe gives these test scripts for a generated/custom Vitest setup:

  ```json
  {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:debug": "vitest --inspect-brk --no-file-parallelism",
    "test:e2e": "vitest run --config ./vitest.config.e2e.ts"
  }
  ```

  Source: [SWC/Vitest recipe](https://github.com/nestjs/docs.nestjs.com/blob/master/content/recipes/swc.md).
- Jest remains the CLI-generated default for CommonJS projects. The official docs do not require replacing Jest in an existing CommonJS project; choose the runner that matches the generated module system or keep the current runner. Source: [Migration guide](https://docs.nestjs.com/migration).

## Implication for this repository

This repository is ESM (`"type": "module"`) and already uses the official Vitest script shape, including the separate E2E config. Its `build`, `start`, `start:dev`, and `start:debug` scripts also match the CLI documentation's local-package-script recommendation.
