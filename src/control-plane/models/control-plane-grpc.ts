import { fileURLToPath } from "node:url";
import { type GrpcOptions, Transport } from "@nestjs/microservices";

/** The contract both adapters serve; nest-cli.json copies it next to the build. */
export const CONTROL_PLANE_PROTO_PATH = fileURLToPath(
  new URL("../data/control_plane.proto", import.meta.url),
);

/** The service name `@GrpcMethod` handlers name (control_plane.proto). */
export const CONTROL_PLANE_SERVICE = "ControlPlane";

const CONTROL_PLANE_PACKAGE = "routerlm.integration.v1";

/**
 * The gRPC server the worker runs when CONTROL_PLANE_PORT is set (ADR 0033):
 * plaintext h2c on every interface, for a private network or a TLS proxy.
 */
export function controlPlaneGrpcOptions(port: number): GrpcOptions {
  return {
    transport: Transport.GRPC,
    options: {
      package: CONTROL_PLANE_PACKAGE,
      protoPath: CONTROL_PLANE_PROTO_PATH,
      url: `0.0.0.0:${port}`,
      // lowerCamelCase names, as in proto3's JSON mapping, so both adapters
      // check requests with the same schemas (models/proto-grpc.ts). Unset
      // request fields stay absent rather than taking defaults, so "not sent"
      // reads as it does over HTTP.
      loader: { keepCase: false, longs: String, enums: String, defaults: false, oneofs: false },
    },
  };
}
