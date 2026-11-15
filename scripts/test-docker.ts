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
  return run("bun", ["run", "test"], { ...process.env, ...TEST_ENV });
}

// Ctrl-C reaches the test run too; outliving it lets the teardown below run.
process.on("SIGINT", () => {});

let exitCode = 1;
try {
  exitCode = runTests();
} finally {
  run("docker", [...COMPOSE, "down", "--volumes", "--remove-orphans"], COMPOSE_ENV);
}
process.exit(exitCode);
