import { Hono } from "hono";
import { healthRoutes } from "./routes/health";
import { initRoutes } from "./routes/init";
import type { Runtime } from "./runtime";
import { authRoutes } from "./routes/auth";
import { settingsRoutes } from "./routes/settings";
import { providerRoutes } from "./routes/providers";
import { modelRoutes } from "./routes/models";
import { comboRoutes } from "./routes/combos";
import { apiKeyRoutes } from "./routes/apiKeys";
import { usageRoutes } from "./routes/usage";
import { gatewayRoutes } from "./routes/gateway";
import { providerNodeRoutes } from "./routes/providerNodes";
import { publicRoutes } from "./routes/public";
import { proxyPoolRoutes } from "./routes/proxyPools";
import { headroomRoutes } from "./routes/headroom";
import { pxpipeRoutes } from "./routes/pxpipe";
import { tunnelRoutes } from "./routes/tunnels";
import { translatorRoutes } from "./routes/translator";
import { cliToolRoutes } from "./routes/cliTools";
import { mcpRoutes } from "./routes/mcp";
import { mitmRoutes } from "./routes/mitm";
import { pricingRoutes } from "./routes/pricing";
import { freeTrackerRoutes } from "./routes/freeTracker";
import { quotaRoutes } from "./routes/quota";
import { queueJobRoutes } from "./routes/queueJobs";
import { databaseRoutes } from "./routes/database";
import { oauthRoutes } from "./routes/oauth";
import { providerExtraRoutes } from "./routes/providerExtras";
import { geminiRoutes } from "./routes/gemini";
import { oauthSpecialRoutes } from "./routes/oauthSpecial";
import { connectRoutes } from "./routes/connect";
import { publicStatsRoutes } from "./routes/publicStats";
import { mediaProviderRoutes } from "./routes/mediaProviders";
import { schedulerRoutes } from "./routes/scheduler";
import { visionAdapterRoutes } from "./routes/visionAdapters";
import { dashboardChatRoutes } from "./routes/dashboardChat";
import { shutdownRoutes, versionRoutes } from "./routes/version";

export function createApp(runtime?: Runtime) {
  const app = new Hono();

  app.onError((error, context) => {
    if (error instanceof SyntaxError || /JSON|body/i.test(error.message)) {
      return context.json({ error: { message: "Invalid request body", type: "invalid_request_error" } }, 400);
    }
    console.error("[Backend] request failed", error);
    return context.json({ error: { message: "Internal server error", type: "internal_error" } }, 500);
  });

  app.route("/api/health", healthRoutes);
  app.route("/api/init", initRoutes);

  if (runtime) {
    app.route("/api/version", versionRoutes(runtime));
    app.route("/api/shutdown", shutdownRoutes(runtime));
    app.route("/api", publicRoutes(runtime));
    app.route("/api/auth", authRoutes(runtime));
    app.route("/api/oauth", oauthSpecialRoutes(runtime));
    app.route("/api/oauth", oauthRoutes(runtime));
    app.route("/api/providers", providerExtraRoutes(runtime));
    app.route("/api/settings/database", databaseRoutes(runtime));
    app.route("/api/settings", settingsRoutes(runtime));
    app.route("/api/providers", providerRoutes(runtime));
    app.route("/api/provider-nodes", providerNodeRoutes(runtime));
    app.route("/api/proxy-pools", proxyPoolRoutes(runtime));
    app.route("/api/headroom", headroomRoutes(runtime));
    app.route("/api/pxpipe", pxpipeRoutes(runtime));
    app.route("/api/tunnel", tunnelRoutes(runtime));
    // Register the more specific MITM prefix before the generic CLI tool route.
    app.route("/api/models", modelRoutes(runtime));
    app.route("/api/combos", comboRoutes(runtime));
    app.route("/api/keys", apiKeyRoutes(runtime));
    app.route("/api/usage", usageRoutes(runtime));
    app.route("/api/translator", translatorRoutes(runtime));
    // Register the specific MITM prefix before the generic CLI route.
    app.route("/api/cli-tools/antigravity-mitm", mitmRoutes(runtime));
    app.route("/api/cli-tools", cliToolRoutes(runtime));
    app.route("/api/mcp", mcpRoutes(runtime));
    app.route("/api/connect", connectRoutes(runtime));
    app.route("/api/public", publicStatsRoutes(runtime));
    app.route("/api/media-providers", mediaProviderRoutes(runtime));
    app.route("/api/dashboard", dashboardChatRoutes(runtime));
    app.route("/api/scheduler", schedulerRoutes(runtime));
    app.route("/api/vision-adapters", visionAdapterRoutes(runtime));
    app.route("/api/pricing", pricingRoutes(runtime));
    app.route("/api/free-tracker", freeTrackerRoutes(runtime));
    app.route("/api/quota", quotaRoutes(runtime));
  app.route("/api/queue-jobs", queueJobRoutes(runtime));
    app.route("/v1", gatewayRoutes(runtime));
    app.route("/v1/v1", gatewayRoutes(runtime));
    app.route("/api/v1", gatewayRoutes(runtime));
    app.route("/v1beta", geminiRoutes(runtime));
    app.route("/v1beta", gatewayRoutes(runtime));
    app.route("/api/v1beta", gatewayRoutes(runtime));
    app.route("/responses", gatewayRoutes(runtime));
    app.route("/codex", gatewayRoutes(runtime));
  }

  return app;
}

export type BackendApp = ReturnType<typeof createApp>;
