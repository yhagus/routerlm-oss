import {
  BarChart3,
  Boxes,
  Cpu,
  KeyRound,
  LayoutDashboard,
  MessageSquareText,
  Network,
  TriangleAlert,
  Users,
  Wallet,
} from "@lucide/vue";
import type { Component } from "vue";

export interface NavigationItem {
  label: string;
  path: string;
  icon: Component;
}

export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

/** The dashboard's pages, grouped as the sidebar shows them. */
export const navigationGroups: NavigationGroup[] = [
  {
    label: "Gateway",
    items: [
      { label: "Overview", path: "/", icon: LayoutDashboard },
      { label: "Usage", path: "/usage", icon: BarChart3 },
      { label: "Error Captures", path: "/error-captures", icon: TriangleAlert },
      { label: "Playground", path: "/playground", icon: MessageSquareText },
    ],
  },
  {
    label: "Routing",
    items: [{ label: "Models", path: "/models", icon: Boxes }],
  },
  {
    label: "Upstream",
    items: [
      { label: "Providers", path: "/providers", icon: Network },
      { label: "Provider Accounts", path: "/provider-accounts", icon: Wallet },
      { label: "Upstream Models", path: "/upstream-models", icon: Cpu },
    ],
  },
  {
    label: "Access",
    items: [
      { label: "API Keys", path: "/api-keys", icon: KeyRound },
      { label: "Users", path: "/users", icon: Users },
    ],
  },
];

/** The page a path belongs to, for the breadcrumb. `/models/<id>` belongs to Models. */
export function findNavigationItem(path: string): NavigationItem | undefined {
  return navigationGroups
    .flatMap((group) => group.items)
    .find((item) => item.path === path || path.startsWith(`${item.path}/`));
}
