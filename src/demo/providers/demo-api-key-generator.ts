import { ApiKeyProvider, type ApiKeyRecord } from "@nestjs/authentication";
import { Injectable } from "@nestjs/common";
import { API_KEY_PREFIX } from "@/api-keys/providers/api-key-auth.js";

/**
 * Makes API Keys exactly as the gateway's ApiKeyAuth does, without the
 * snapshot and Redis that signing in with them needs. It signs no one in:
 * it is never registered with the AuthenticationRegistry.
 */
@Injectable()
export class DemoApiKeyGenerator extends ApiKeyProvider<never> {
  constructor() {
    super({ prefix: API_KEY_PREFIX });
  }

  protected findKey(): ApiKeyRecord<never> | null {
    return null;
  }
}
