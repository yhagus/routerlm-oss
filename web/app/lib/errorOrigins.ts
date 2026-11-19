/**
 * Who caused a failed request: the client, a Provider, or the gateway itself
 * (GLOSSARY "Error Origin", ADR 0031), as the backend's `ERROR_ORIGINS` says.
 */
export const ERROR_ORIGINS = ["client", "upstream", "gateway"] as const;
export type ErrorOrigin = (typeof ERROR_ORIGINS)[number];

export const ERROR_ORIGIN_LABELS: Record<ErrorOrigin, string> = {
  client: "Client",
  upstream: "Upstream",
  gateway: "Gateway",
};
