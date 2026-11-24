import { type ArgumentsHost, Catch, type ExceptionFilter, Inject } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import {
  CONTROL_PLANE_ERRORS,
  controlPlaneErrorOf,
} from "@/control-plane/models/control-plane-error.js";
import type { ErrorJson } from "@/control-plane/models/proto-json.js";

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
