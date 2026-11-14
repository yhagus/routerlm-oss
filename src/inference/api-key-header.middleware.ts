import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable, type NestMiddleware } from "@nestjs/common";

/**
 * Anthropic clients send their key as `x-api-key`, but ApiKeyAuth reads only
 * `Authorization: Bearer`. This copies the key across, so ApiKeyAuth still
 * does every check (ADR 0005). An explicit Authorization header wins.
 */
@Injectable()
export class ApiKeyHeaderMiddleware implements NestMiddleware<IncomingMessage, ServerResponse> {
  use(request: IncomingMessage, _response: ServerResponse, next: () => void): void {
    const apiKey = request.headers["x-api-key"];
    if (typeof apiKey === "string" && request.headers.authorization === undefined) {
      request.headers.authorization = `Bearer ${apiKey}`;
    }
    next();
  }
}
