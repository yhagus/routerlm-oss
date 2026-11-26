import type { UpstreamProtocol } from "@/db/schemas";
import { endpointOf } from "@/inference/models/route-selection";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot";

export interface CallableEndpoint<Adapter> {
  protocol: UpstreamProtocol;
  baseUrl: string;
  adapter: Adapter;
}

export function callableEndpointOf<Adapter>(
  upstreamModel: SnapshotUpstreamModel,
  adapters: Partial<Record<UpstreamProtocol, Adapter>>,
  preferredProtocol?: UpstreamProtocol,
): CallableEndpoint<Adapter> {
  const endpoint = endpointOf(upstreamModel, preferredProtocol);
  const adapter = endpoint && adapters[endpoint.protocol];
  if (!endpoint || !adapter) {
    throw new Error(
      `The Provider ${upstreamModel.provider.slug} has no ${upstreamModel.kind} endpoint the gateway can call`,
    );
  }
  return { protocol: endpoint.protocol, baseUrl: endpoint.baseUrl, adapter };
}
