import open from "open";
import { startLocalServer } from "../utils/server.ts";
import { generatePKCE } from "../utils/pkce.ts";
import { spinner as createSpinner } from "../utils/ui.ts";
import { OAUTH_TIMEOUT } from "../constants/oauth.ts";

/**
 * Generic OAuth Authorization Code Flow with PKCE
 */
export class OAuthService {
  config: any;
  constructor(config: any) {
    this.config = config;
  }

  /**
   * Build authorization URL
   */
  buildAuthUrl(redirectUri: any, state: any, codeChallenge: any, extraParams: any = {}) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: this.config.codeChallengeMethod,
      ...extraParams,
    });

    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Start local server and wait for callback
   */
  async startAuthFlow(authUrl: any, providerName: any) {
    const spinner = createSpinner("Starting local server...").start();

    // Start local server for callback
    let callbackParams: any = null;
    const { port, close } = await startLocalServer((params: any) => {
      callbackParams = params;
    });

    const redirectUri = `http://localhost:${port}/callback`;
    spinner.succeed(`Local server started on port ${port}`);

    return {
      redirectUri,
      port,
      close,
      waitForCallback: async () => {
        spinner.start(`Waiting for ${providerName} authorization...`);

        await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Authentication timeout (5 minutes)"));
          }, OAUTH_TIMEOUT);

          const checkInterval = setInterval(() => {
            if (callbackParams) {
              clearInterval(checkInterval);
              clearTimeout(timeout);
              resolve(undefined);
            }
          }, 100);
        });

        spinner.stop();
        close();

        if (callbackParams.error) {
          throw new Error(callbackParams.error_description || callbackParams.error);
        }

        if (!callbackParams.code) {
          throw new Error("No authorization code received");
        }

        return callbackParams;
      },
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: any, redirectUri: any, codeVerifier: any, contentType = "application/x-www-form-urlencoded") {
    const body =
      contentType === "application/json"
        ? JSON.stringify({
            grant_type: "authorization_code",
            client_id: this.config.clientId,
            code: code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          })
        : new URLSearchParams({
            grant_type: "authorization_code",
            client_id: this.config.clientId,
            code: code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          });

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        Accept: "application/json",
      },
      body: body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Complete OAuth flow
   */
  async authenticate(providerName: any, buildAuthUrlFn: any) {
    // Generate PKCE
    const { codeVerifier, codeChallenge, state } = generatePKCE();

    // Start local server and get redirect URI
    const { redirectUri, waitForCallback } = await this.startAuthFlow(null, providerName);

    // Build authorization URL
    const authUrl = buildAuthUrlFn(redirectUri, state, codeChallenge);

    console.log(`\nOpening browser for ${providerName} authentication...`);
    console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

    // Open browser
    await open(authUrl);

    // Wait for callback
    const callbackParams = await waitForCallback();

    // Validate state
    if (callbackParams.state !== state) {
      throw new Error("Invalid state parameter");
    }

    return {
      code: callbackParams.code,
      state: callbackParams.state,
      codeVerifier,
      redirectUri,
    };
  }
}

