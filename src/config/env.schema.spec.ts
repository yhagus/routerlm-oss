import { envSchema } from "./env.schema.js";

const VALID_ENV = {
  DATABASE_URL: "postgres://routerlm:routerlm@localhost:5432/routerlm",
  REDIS_URL: "redis://localhost:6379",
  ENCRYPTION_KEY: "q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq80=",
};

function errorMessagesFor(env: Record<string, string>): string {
  const result = envSchema.safeParse(env);
  return result.success ? "" : result.error.issues.map((issue) => issue.message).join("\n");
}

describe("envSchema ENCRYPTION_KEY", () => {
  it("accepts 32 bytes in base64", () => {
    expect(envSchema.safeParse(VALID_ENV).success).toBe(true);
  });

  it("refuses to start without it and says how to generate one", () => {
    const { ENCRYPTION_KEY: _missing, ...withoutKey } = VALID_ENV;

    expect(errorMessagesFor(withoutKey)).toContain("openssl rand -base64 32");
  });

  it("refuses a key that isn't 32 bytes", () => {
    expect(errorMessagesFor({ ...VALID_ENV, ENCRYPTION_KEY: "c2hvcnQ=" })).toContain(
      "ENCRYPTION_KEY",
    );
  });
});
