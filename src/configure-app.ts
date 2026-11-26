import {
  type NestNodeApplication,
  NodeAdapter,
  type NodeAdapterOptions,
} from '@nestjs/platform-node';

export const REQUEST_BODY_LIMIT = '20mb';

export function configureApp(app: NestNodeApplication): void {
  app.useBodyParser('json', { limit: REQUEST_BODY_LIMIT });
}

const MAX_PARAM_LENGTH = 1024;

export function createNodeAdapter(): NodeAdapter {
  return new NodeAdapter({
    trustProxy: trustProxyOf(process.env.TRUST_PROXY),
    maxParamLength: MAX_PARAM_LENGTH,
  });
}

function trustProxyOf(setting: string | undefined): NodeAdapterOptions['trustProxy'] {
  if (!setting || setting === 'false') return false;
  if (setting === 'true') return true;
  return setting;
}
