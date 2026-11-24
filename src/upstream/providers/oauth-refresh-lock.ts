import { Injectable } from "@nestjs/common";
import { type Lock, Locks } from "@nestjs/locks";
import { CredentialUnavailableError } from "@/upstream/models/provider-account-credential.js";

const LOCK_KEY_PREFIX = "oauth-refresh:";
const LOCK_WAIT = "45s";

@Injectable()
export class OauthRefreshLock {
  constructor(private readonly locks: Locks) {}

  async run<Result>(providerAccountId: string, work: () => Promise<Result>): Promise<Result> {
    const lock = await this.take(providerAccountId);
    try {
      return await work();
    } finally {
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
