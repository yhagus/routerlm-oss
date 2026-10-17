// Ensure outbound fetch respects HTTP(S)_PROXY/ALL_PROXY in Node runtime
import "../../../common/proxyFetch.ts";

import { generatePKCE } from "../utils/pkce.ts";
import { extractCodexAccountInfo } from "../providerHelpers.ts";

import claude from "./claude.ts";
import codex from "./codex.ts";
import deepseekHarness from "./deepseek-harness.ts";
import grokCli from "./grok-cli.ts";
import antigravity from "./antigravity.ts";
import qoder from "./qoder.ts";
import codebuddyCn from "./codebuddy-cn.ts";
import codebuddyIntlCli from "./codebuddy-intl-cli.ts";

// Provider configurations
const PROVIDERS = {
  claude,
  codex,
  "deepseek-harness": deepseekHarness,
  "grok-cli": grokCli,
  antigravity,
  qoder,
  "codebuddy-cn": codebuddyCn,
  "codebuddy-intl-cli": codebuddyIntlCli,
};

export { PROVIDERS };

// Re-export helpers that other files import from this path
export { extractCodexAccountInfo };

/**
 * Get provider handler
 */
export function getProvider(name: any) {
  const provider = (PROVIDERS as Record<string, any>)[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

/**
 * Get all provider names
 */
export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

/**
 * Generate auth data for a provider
 * @param {object} [meta] - Provider-specific metadata (e.g. deepseek-harness redirect_uri)
 */
export async function generateAuthData(providerName: any, redirectUri: any, meta: any) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;
  const { codeVerifier, codeChallenge, state: pkceState } = generatePKCE(provider.pkceVerifierBytes);
  // deepseek-harness uses loginTraceID (set by prepareConfig) as the callback matcher, not PKCE state.
  const state = config.loginTraceID || pkceState;

  let authUrl;
  if (provider.flowType === "device_code") {
    // Device code flow doesn't have auth URL upfront
    authUrl = null;
  } else if (provider.flowType === "authorization_code_pkce") {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, codeChallenge, meta || {});
  } else {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, undefined, meta || {});
  }
  // Async buildAuthUrl providers (deepseek-harness auth_init) resolve before returning.
  if (authUrl && typeof authUrl.then === "function") authUrl = await authUrl;

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback",
  };
}

/**
 * Exchange code for tokens
 * @param {object} [meta] - Provider-specific metadata (e.g. deepseek-harness redirect_uri)
 */
export async function exchangeTokens(providerName: any, code: any, redirectUri?: any, codeVerifier?: any, state?: any, meta?: any) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;

  const tokens = await provider.exchangeToken(config, code, redirectUri, codeVerifier, state, meta || {});

  let extra = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

/**
 * Request device code (for device_code flow)
 */
export async function requestDeviceCode(providerName: any, codeChallenge: any, options: any) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  return await provider.requestDeviceCode(provider.config, codeChallenge, options || {});
}

/**
 * Poll for token (for device_code flow)
 * @param {string} providerName - Provider name
 * @param {string} deviceCode - Device code from requestDeviceCode
 * @param {string} codeVerifier - PKCE code verifier (optional for some providers)
 * @param {object} extraData - Extra data from device code response
 */
export async function pollForToken(providerName: any, deviceCode: any, codeVerifier: any, extraData: any) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }

  const result = await provider.pollToken(provider.config, deviceCode, codeVerifier, extraData);

  if (result.ok) {
    // For device code flows, success is only when we have an access token
    if (result.data.access_token) {
      // Call postExchange to get additional data (userInfo, etc.)
      let extra = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data);
      }
      const tokens = provider.mapTokens(result.data, extra);
      return { success: true, tokens };
    } else {
      // Check if it's still pending authorization
      if (result.data.error === 'authorization_pending' || result.data.error === 'slow_down') {
        // This is not a failure, just still waiting
        return {
          success: false,
          error: result.data.error,
          errorDescription: result.data.error_description || result.data.message,
          pending: result.data.error === 'authorization_pending'
        };
      } else {
        // Actual error
        return {
          success: false,
          error: result.data.error || 'no_access_token',
          errorDescription: result.data.error_description || result.data.message || 'No access token received'
        };
      }
    }
  }

  return { success: false, error: result.data.error, errorDescription: result.data.error_description };
}
