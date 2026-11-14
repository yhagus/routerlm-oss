// Runs the e2e tests against throwaway Postgres and Redis containers from
// docker-compose.test.yml, then removes them, whether the tests pass or not.
import { spawnSync } from "node:child_process";

const COMPOSE = ["compose", "-f", "docker-compose.test.yml"];
const TEST_ENV = {
  DATABASE_URL: "postgres://routerlm:routerlm@localhost:55432/routerlm",
  TEST_DATABASE_URL: "postgres://routerlm:routerlm@localhost:55432/routerlm_test",
  REDIS_URL: "redis://localhost:56379",
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
  const upStatus = run("docker", [...COMPOSE, "up", "-d", "--wait"]);
  if (upStatus !== 0) {
    console.error("test:e2e:docker: the test services did not become healthy.");
    return upStatus;
  }
  return run("bun", ["run", "test:e2e"], { ...process.env, ...TEST_ENV });
}

// Ctrl-C reaches the test run too; outliving it lets the teardown below run.
process.on("SIGINT", () => {});

let exitCode = 1;
try {
  exitCode = runTests();
} finally {
  run("docker", [...COMPOSE, "down", "--volumes", "--remove-orphans"]);
}
process.exit(exitCode);
