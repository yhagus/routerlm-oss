import { fileURLToPath } from 'node:url';
import { type GrpcOptions, Transport } from '@nestjs/microservices';

export const CONTROL_PLANE_PROTO_PATH = fileURLToPath(
  new URL('../data/control_plane.proto', import.meta.url),
);

export const CONTROL_PLANE_SERVICE = 'ControlPlane';

const CONTROL_PLANE_PACKAGE = 'routerlm.integration.v1';

export function controlPlaneGrpcOptions(port: number): GrpcOptions {
  return {
    transport: Transport.GRPC,
    options: {
      package: CONTROL_PLANE_PACKAGE,
      protoPath: CONTROL_PLANE_PROTO_PATH,
      url: `0.0.0.0:${port}`,
      loader: { keepCase: false, longs: String, enums: String, defaults: false, oneofs: false },
    },
  };
}
