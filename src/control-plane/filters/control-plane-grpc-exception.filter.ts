import { type ArgumentsHost, Catch, type RpcExceptionFilter } from '@nestjs/common';
import { GrpcException, GrpcExceptionFilter } from '@nestjs/microservices';
import { type Observable, throwError } from 'rxjs';
import {
  CONTROL_PLANE_ERRORS,
  controlPlaneErrorOf,
} from '@/control-plane/models/control-plane-error';

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
