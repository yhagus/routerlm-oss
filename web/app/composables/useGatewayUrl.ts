export const DOCS_PLACEHOLDER_URL = 'https://gateway.example.com';

const DEFAULT_GATEWAY_PORT = 3000;

export function useGatewayUrl(): { withGatewayUrl: (text: string) => string } {
  const configuredUrl = useRuntimeConfig().public.gatewayUrl;
  const gatewayUrl = (
    configuredUrl || `${location.protocol}//${location.hostname}:${DEFAULT_GATEWAY_PORT}`
  ).replace(/\/+$/, '');

  return { withGatewayUrl: (text) => text.replaceAll(DOCS_PLACEHOLDER_URL, gatewayUrl) };
}
