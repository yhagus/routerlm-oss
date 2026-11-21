import { HttpException } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";

/**
 * The control plane's errors, named as gRPC names its status codes, with the
 * HTTP status and gRPC code each adapter answers them with (control_plane.proto).
 */
export const CONTROL_PLANE_ERROR_CODES = [
  "UNAUTHENTICATED",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "FAILED_PRECONDITION",
] as const;
export type ControlPlaneErrorCode = (typeof CONTROL_PLANE_ERROR_CODES)[number];

export const CONTROL_PLANE_ERRORS: Record<
  ControlPlaneErrorCode,
  { httpStatus: number; grpcCode: number }
> = {
  UNAUTHENTICATED: { httpStatus: 401, grpcCode: 16 },
  INVALID_ARGUMENT: { httpStatus: 400, grpcCode: 3 },
  NOT_FOUND: { httpStatus: 404, grpcCode: 5 },
  FAILED_PRECONDITION: { httpStatus: 409, grpcCode: 9 },
};

/** What a control plane command or query throws to refuse a call, whatever the transport. */
export class ControlPlaneError extends Error {
  constructor(
    readonly code: ControlPlaneErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function apiKeyNotFound(): ControlPlaneError {
  return new ControlPlaneError("NOT_FOUND", "API Key not found");
}

/**
 * The control plane error an exception stands for, or null for one outside
 * the contract (a bug, answered as an internal error). Besides ControlPlaneError,
 * Nest's HTTP exceptions count too: validation pipes and shared helpers throw
 * those on every transport, and the authentication guard over HTTP. Over gRPC
 * the guard throws an RpcException carrying the HTTP status as `statusCode`.
 */
export function controlPlaneErrorOf(exception: unknown): ControlPlaneError | null {
  if (exception instanceof ControlPlaneError) {
    return exception;
  }
  const status = httpStatusOf(exception);
  const code = CONTROL_PLANE_ERROR_CODES.find(
    (candidate) => CONTROL_PLANE_ERRORS[candidate].httpStatus === status,
  );
  return code && exception instanceof Error ? new ControlPlaneError(code, exception.message) : null;
}

function httpStatusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (!(exception instanceof RpcException)) {
    return undefined;
  }
  const error = exception.getError();
  if (typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return undefined;
}
