import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable, type NestMiddleware } from "@nestjs/common";

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
