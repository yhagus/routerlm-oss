import { Injectable } from "@nestjs/common";
import { type Lock, Locks } from "@nestjs/locks";
import { CredentialUnavailableError } from "../models/provider-account-credential.js";

const LOCK_KEY_PREFIX = "oauth-refresh:";
/**
 * How long a request waits for another's refresh before it gives up on the
 * account: longer than a refresh with all its retries.
 */
const LOCK_WAIT = "45s";

/**
 * One lock per Provider Account around replacing its OAuth Login, shared by
 * the backend and worker processes: a refresh rotates the refresh token, and
 * two at once would lose one of them. On the first-party `@nestjs/locks`
 * (ADR 0001), whose store is in Redis.
 */
@Injectable()
export class OauthRefreshLock {
  constructor(private readonly locks: Locks) {}

  /**
   * Runs `work` while holding the Provider Account's lock, waiting for its
   * turn. Throws CredentialUnavailableError when the lock can't be taken.
   */
  async run<Result>(providerAccountId: string, work: () => Promise<Result>): Promise<Result> {
    const lock = await this.take(providerAccountId);
    try {
      return await work();
    } finally {
      // A failed release costs the next refresh a wait, never a wrong token.
      await lock.release().catch(() => false);
    }
  }

  private async take(providerAccountId: string): Promise<Lock> {
    let lock: Lock | null;
    try {
      lock = await this.locks.acquire(LOCK_KEY_PREFIX + providerAccountId, { wait: LOCK_WAIT });
    } catch (error) {
      throw new CredentialUnavailableError("The OAuth Login refresh lock is unreachable", {
        cause: error,
      });
    }
    if (lock === null) {
      throw new CredentialUnavailableError("Another refresh of this OAuth Login did not finish");
    }
    return lock;
  }
}
