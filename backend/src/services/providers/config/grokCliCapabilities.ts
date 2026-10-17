/**
 * Grok CLI / Grok Build capabilities configuration.
 * Defines hosted tool types accepted by the Responses proxy.
 */

// Hosted tools supported by Grok Build
export const SUPPORTED_HOSTED_TOOLS = [
  'web_search',
  'x_search',
  'web_search_preview',
  'file_search',
  'image_generation',
  'code_interpreter',
  'mcp',
  'shell',
  'local_shell',
];

/** Return compatibility warnings without rejecting client-defined tools. */
export function validateToolCalls(body: any) {
  return [];
}
