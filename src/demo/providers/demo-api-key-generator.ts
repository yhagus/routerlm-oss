import { ApiKeyProvider, type ApiKeyRecord } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { API_KEY_PREFIX } from '@/api-keys/providers/api-key-auth';

@Injectable()
export class DemoApiKeyGenerator extends ApiKeyProvider<never> {
  constructor() {
    super({ prefix: API_KEY_PREFIX });
  }

  protected findKey(): ApiKeyRecord<never> | null {
    return null;
  }
}
