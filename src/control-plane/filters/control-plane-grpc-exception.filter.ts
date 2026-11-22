import { type ArgumentsHost, Catch, type RpcExceptionFilter } from "@nestjs/common";
import { GrpcException, GrpcExceptionFilter } from "@nestjs/microservices";
import { type Observable, throwError } from "rxjs";
import {
  CONTROL_PLANE_ERRORS,
  controlPlaneErrorOf,
} from "@/control-plane/models/control-plane-error.js";

/**
 * Answers the control plane's errors over gRPC with the status code
 * control_plane.proto maps each one to, the guard's UNAUTHENTICATED included.
 * Anything else (a bug) keeps Nest's default UNKNOWN.
 */
@Catch()
export class ControlPlaneGrpcExceptionFilter implements RpcExceptionFilter {
  private readonly defaultFilter = new GrpcExceptionFilter();

  catch(exception: unknown, host: ArgumentsHost): Observable<unknown> {
    const error = controlPlaneErrorOf(exception);
    if (!error) {
      return this.defaultFilter.catch(exception, host);
    }
    const grpcError = new GrpcException(error.message, CONTROL_PLANE_ERRORS[error.code].grpcCode);
    return throwError(() => grpcError.getError());
  }
}
