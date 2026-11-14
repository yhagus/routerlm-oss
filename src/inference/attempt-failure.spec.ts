import { AttemptFailedError, exhaustionError } from "./attempt-failure.js";

function failure(reason: AttemptFailedError["reason"]): AttemptFailedError {
  return new AttemptFailedError(reason, null, "upstream text the client never sees");
}

describe("exhaustionError", () => {
  it("answers 429 upstream_rate_limited when every Attempt was rate limited", () => {
    const error = exhaustionError([failure("rate_limited"), failure("rate_limited")]);

    expect([error.status, error.code]).toEqual([429, "upstream_rate_limited"]);
  });

  it("answers 504 upstream_timeout when every Attempt timed out", () => {
    const error = exhaustionError([failure("timeout"), failure("timeout")]);

    expect([error.status, error.code]).toEqual([504, "upstream_timeout"]);
  });

  it("answers 502 upstream_error when the Attempts failed in different ways", () => {
    const error = exhaustionError([failure("rate_limited"), failure("timeout")]);

    expect([error.status, error.code]).toEqual([502, "upstream_error"]);
  });

  it("answers 502 upstream_error when no Provider Account could be tried", () => {
    const error = exhaustionError([]);

    expect([error.status, error.code]).toEqual([502, "upstream_error"]);
  });
});
