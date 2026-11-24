import {
  BarChart3,
  Blocks,
  Boxes,
  CalendarClock,
  Cpu,
  KeyRound,
  LayoutDashboard,
  MessageSquareText,
  Network,
  Settings,
  TriangleAlert,
  Users,
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
      { label: "Upstream Models", path: "/upstream-models", icon: Cpu },
      { label: "Pricing Windows", path: "/pricing-windows", icon: CalendarClock },
    ],
  },
  {
    label: "Access",
    items: [
      { label: "API Keys", path: "/api-keys", icon: KeyRound },
      { label: "Integrations", path: "/integrations", icon: Blocks },
      { label: "Users", path: "/users", icon: Users },
    ],
  },
  {
    label: "System",
    items: [{ label: "Settings", path: "/settings", icon: Settings }],
  },
];

export function findNavigationItem(path: string): NavigationItem | undefined {
  return navigationGroups
    .flatMap((group) => group.items)
    .find((item) => item.path === path || path.startsWith(`${item.path}/`));
}
