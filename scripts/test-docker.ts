// Runs the feature tests against throwaway Postgres and Redis containers from
// docker-compose.test.yml, then removes them, whether the tests pass or not.
// Every run gets its own Compose project and free host ports, so runs in
// several worktrees at once never share or collide on a stack.
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

/** A host port that is free right now, chosen by the OS. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

const dbPort = await freePort();
const redisPort = await freePort();
const PROJECT = `routerlm-oss-test-${process.pid}`;
const COMPOSE = ["compose", "-p", PROJECT, "-f", "docker-compose.test.yml"];
const COMPOSE_ENV = {
  ...process.env,
  TEST_DB_PORT: String(dbPort),
  TEST_REDIS_PORT: String(redisPort),
};
const TEST_ENV = {
  DATABASE_URL: `postgres://routerlm:routerlm@localhost:${dbPort}/routerlm`,
  TEST_DATABASE_URL: `postgres://routerlm:routerlm@localhost:${dbPort}/routerlm_test`,
  REDIS_URL: `redis://localhost:${redisPort}`,
  // A fixed test-only key; it encrypts nothing real.
  ENCRYPTION_KEY: "dGVzdC1vbmx5LWVuY3J5cHRpb24ta2V5LTMyLWJ5dGU=",
};

/** Runs a command with inherited output and returns its exit code. */
function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) {
    throw new Error(`could not run ${command} ${args.join(" ")}`, { cause: result.error });
  }
  return result.status ?? 1;
}

function runTests(): number {
  const upStatus = run("docker", [...COMPOSE, "up", "-d", "--wait"], COMPOSE_ENV);
  if (upStatus !== 0) {
    console.error("test:docker: the test services did not become healthy.");
    return upStatus;
  }
  // Arguments go to vitest: `bun run test:docker tests/health` runs only that folder.
  return run("bun", ["run", "test", ...process.argv.slice(2)], { ...process.env, ...TEST_ENV });
}

// Ctrl-C reaches the test run too; outliving it lets the teardown below run.
process.on("SIGINT", () => {});

/**
 * Removes the test stack quietly, printing Compose's output only when it fails,
 * so the test summary stays the last thing a truncated log shows.
 */
function tearDown(): void {
  const result = spawnSync("docker", [...COMPOSE, "down", "--volumes", "--remove-orphans"], {
    env: COMPOSE_ENV,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    console.error("test:docker: could not remove the test services.");
  }
}

let exitCode = 1;
try {
  exitCode = runTests();
} finally {
  tearDown();
}
console.log(`test:docker: tests ${exitCode === 0 ? "passed" : `failed (exit ${exitCode})`}.`);
process.exit(exitCode);
