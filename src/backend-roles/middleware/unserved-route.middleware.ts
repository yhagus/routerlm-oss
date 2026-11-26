import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, type NestMiddleware, NotFoundException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Injectable()
export class UnservedRouteMiddleware implements NestMiddleware<IncomingMessage, ServerResponse> {
  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  use(request: IncomingMessage): never {
    const { httpAdapter } = this.adapterHost;
    const method = httpAdapter.getRequestMethod(request);
    const url = httpAdapter.getRequestUrl(request);
    throw new NotFoundException(`Cannot ${method} ${url}`);
  }
}
