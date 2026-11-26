---
status: accepted
areas: [control-plane]
---
# The control plane's gRPC adapter is mapped onto the HTTP adapter's bodies so one set of schemas checks both

ADR 0033 serves the control plane over HTTP and gRPC from one contract, `control_plane.proto`. The two adapters must refuse and accept the same requests.

We decided that the gRPC adapter converts each request into the HTTP adapter's JSON body (`newKeyJsonOf`, `keyChangesJsonOf` in `src/control-plane/models/proto-grpc.ts`) and checks it with the same Zod schemas. To make that work: `controlPlaneGrpcOptions` loads the proto with `keepCase: false` and `defaults: false`, so names are lowerCamelCase as in proto3's JSON mapping and an unset field stays absent, as "not sent" does over HTTP; HTTP bodies follow the same mapping (`src/control-plane/models/proto-json.ts`). An update mask's listed fields become the body, with an unset one meaning null (cleared); a path outside the key settings stays in so the strict schema refuses it as over HTTP. Ids are not parsed as uuids by the controllers: a malformed id is NOT_FOUND on both transports (`findCustomerApiKey`).

## Consequences

- Turning on proto-loader defaults, or parsing ids as uuids in the HTTP controller, makes the transports disagree.
- A new control plane operation needs a mapper and a schema, covered by a test on each transport.
