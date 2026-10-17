export function deepseekHarnessPlatformHeaders(): Record<string, string> {
  return {
    "x-client-bundle-id": "",
    "x-client-platform": "web",
    "x-client-version": "0.2.1-alpha.2",
    "x-client-locale": "en_US",
    "x-client-timezone-offset": String(-new Date().getTimezoneOffset() * 60),
  };
}
