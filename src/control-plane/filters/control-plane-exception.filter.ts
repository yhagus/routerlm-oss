import { type ArgumentsHost, Catch, type ExceptionFilter, Inject } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import { CONTROL_PLANE_ERRORS, controlPlaneErrorOf } from "../models/control-plane-error.js";
import type { ErrorJson } from "../models/proto-json.js";

/**
 * Answers the control plane's errors over HTTP as `{code, message}` with the
 * HTTP status control_plane.proto maps the code to, the guard's 401 included.
 * Anything else (a bug) keeps Nest's default 500.
 */
@Catch()
export class ControlPlaneExceptionFilter implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const error = controlPlaneErrorOf(exception);
    if (!error) {
      new BaseExceptionFilter(httpAdapter).catch(exception, host);
      return;
    }
    const body: ErrorJson = { code: error.code, message: error.message };
    httpAdapter.reply(
      host.switchToHttp().getResponse(),
      body,
      CONTROL_PLANE_ERRORS[error.code].httpStatus,
    );
  }
}
