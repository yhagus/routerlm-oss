// Models and their Routes as the dashboard API returns them.

import type { Capability } from "~/lib/upstream";

/** A Model in the Models list. */
export interface ModelSummary {
  id: string;
  /** What clients send as `model`. */
  name: string;
  isEnabled: boolean;
  routeCount: number;
  createdAt: string;
}

/** One Route on the Model page: where it sends requests and whether anything can serve them. */
export interface RouteSummary {
  id: string;
  /** Lower runs first. */
  priority: number;
  isEnabled: boolean;
  provider: { id: string; slug: string; name: string; isEnabled: boolean };
  upstreamModel: {
    id: string;
    upstreamModelId: string;
    capabilities: Capability[];
    isEnabled: boolean;
  };
  /** Zero means the Route can never serve a request. */
  enabledProviderAccountCount: number;
}

/** A Model with its Routes in the order the gateway tries them. */
export interface ModelDetail {
  id: string;
  name: string;
  isEnabled: boolean;
  hasAutomaticCacheBreakpoints: boolean;
  createdAt: string;
  updatedAt: string;
  routes: RouteSummary[];
}
