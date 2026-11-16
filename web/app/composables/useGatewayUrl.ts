/**
 * The base URL every docs example is written with. tests/docs/client-examples.test.ts
 * runs the examples against it, so the Markdown keeps it and the page swaps it at render.
 */
export const DOCS_PLACEHOLDER_URL = "https://gateway.example.com";

/** The backend's port in the default docker compose stack, where the gateway listens. */
const DEFAULT_GATEWAY_PORT = 3000;

/**
 * Puts this gateway's real address into docs text in place of the placeholder:
 * `runtimeConfig.public.gatewayUrl` when set, otherwise the host the browser
 * opened the docs on, at the gateway's default port.
 */
export function useGatewayUrl(): { withGatewayUrl: (text: string) => string } {
  const configuredUrl = useRuntimeConfig().public.gatewayUrl;
  const gatewayUrl = (
    configuredUrl || `${location.protocol}//${location.hostname}:${DEFAULT_GATEWAY_PORT}`
  ).replace(/\/+$/, "");

  return { withGatewayUrl: (text) => text.replaceAll(DOCS_PLACEHOLDER_URL, gatewayUrl) };
}
