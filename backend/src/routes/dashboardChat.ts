import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { getProviderMetadata, resolveProviderId } from "../services/providers/providerCatalog";
import { dispatchChat } from "../services/chat/chat";
import { withAdmission } from "../services/chat/admission";

function resolveModelTarget(runtime: Runtime, model: string): { combo: boolean; provider: string | null } {
  let current = model;
  const aliases = runtime.repos.aliases.list();
  for (let hops = 0; hops < 10 && aliases[current]; hops += 1) current = aliases[current];
  if (runtime.repos.combos.get(current)) return { combo: true, provider: null };
  const slash = current.indexOf("/");
  if (slash <= 0) return { combo: false, provider: null };
  const prefix = current.slice(0, slash);
  const node = runtime.repos.nodes.list().find((item) => item.prefix === prefix);
  return { combo: false, provider: String(node ? node.id : resolveProviderId(prefix)) };
}

function accountLabel(connection: { id: string; name: string | null; email: string | null; data: Record<string, unknown> }): string {
  return String(connection.data.displayName || connection.name || connection.email || connection.id);
}

const SANDBOX_ROOT = resolve(process.cwd(), "sandbox");
const SKILLS_ROOT = resolve(process.cwd(), ".agents", "skills");
const MAX_SKILL_BYTES = 32 * 1024;
const MAX_SANDBOX_FILE_BYTES = 128 * 1024;

function parseArguments(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function resolveSandboxPath(inputPath: string | undefined): string {
  const target = resolve(SANDBOX_ROOT, String(inputPath || "."));
  const escaped = relative(SANDBOX_ROOT, target);
  if (escaped.startsWith("..") || isAbsolute(escaped)) {
    throw new Error("Sandbox path must stay inside the sandbox directory");
  }
  return target;
}

async function listSandboxFiles(inputPath: string | undefined) {
  const target = resolveSandboxPath(inputPath);
  const entries = await readdir(target, { withFileTypes: true });
  return {
    path: inputPath || ".",
    entries: entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    })),
  };
}

async function readSandboxFile(inputPath: string | undefined) {
  const target = resolveSandboxPath(inputPath);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("Sandbox path must refer to a file");
  return {
    path: inputPath,
    content: (await readFile(target, "utf8")).slice(0, MAX_SANDBOX_FILE_BYTES),
    truncated: info.size > MAX_SANDBOX_FILE_BYTES,
  };
}

async function writeSandboxFile(inputPath: string | undefined, content: unknown) {
  if (typeof content !== "string") throw new Error("File content must be a string");
  if (Buffer.byteLength(content, "utf8") > MAX_SANDBOX_FILE_BYTES) {
    throw new Error(`Sandbox files are limited to ${MAX_SANDBOX_FILE_BYTES} bytes`);
  }
  const target = resolveSandboxPath(inputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { path: inputPath, bytes: Buffer.byteLength(content, "utf8"), written: true };
}

async function runTool(name: string, args: Record<string, unknown>) {
  if (name === "sandbox_probe") {
    const sandbox = await stat(SANDBOX_ROOT);
    return {
      tool: name,
      input: args.input || "",
      sandboxExists: sandbox.isDirectory(),
      files: await listSandboxFiles("."),
    };
  }

  if (name === "mcp__sandbox__list_files") {
    return {
      server: "sandbox",
      tool: "list_files",
      ...(await listSandboxFiles(String(args.path || "."))),
    };
  }

  if (name === "sandbox_read_file") {
    return readSandboxFile(String(args.path || ""));
  }

  if (name === "sandbox_write_file") {
    if (typeof args.path !== "string" || !args.path.trim()) throw new Error("A file path is required");
    return writeSandboxFile(args.path, args.content);
  }

  if (name === "load_skill") {
    const skillName = typeof args.skill_name === "string" ? args.skill_name.trim() : "";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(skillName)) {
      throw new Error("A valid skill_name is required");
    }
    const skillPath = resolve(SKILLS_ROOT, skillName, "SKILL.md");
    const escaped = relative(SKILLS_ROOT, skillPath);
    if (escaped.startsWith("..") || isAbsolute(escaped)) {
      throw new Error("Skill path is not allowed");
    }
    return {
      skill: skillName,
      source: `.agents/skills/${skillName}/SKILL.md`,
      content: (await readFile(skillPath, "utf8")).slice(0, MAX_SKILL_BYTES),
    };
  }

  throw new Error(`Unsupported dashboard tool: ${name || "unknown"}`);
}

export function dashboardChatRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/chat/models", async (c) => {
      try {
        return c.json({ object: "list", data: runtime.gateway.models("llm") });
      } catch (error: any) {
        return c.json({ error: { message: error instanceof Error ? error.message : "Failed to load models", type: "server_error" } }, 500);
      }
    })
    .get("/chat/accounts", (c) => {
      const modelName = c.req.query("model")?.trim();
      if (!modelName) return c.json({ error: "Model is required" }, 400);
      try {
        const target = resolveModelTarget(runtime, modelName);

        // A combo chooses accounts independently for each member model, so the
        // playground cannot pin one account across the whole chain.
        if (!target.provider) {
          return c.json({ model: modelName, supportsSelection: false, accounts: [] as any[]});
        }

        const connections = runtime.repos.providers.list().filter((connection) => connection.provider === target.provider);
        // noAuth providers always offer the public connection; optional accounts follow it.
        const publicAccount = getProviderMetadata(target.provider)?.noAuth
          ? [{ id: "noauth", label: "Public", authType: "none", isActive: true }]
          : [];
        return c.json({
          model: modelName,
          provider: target.provider,
          supportsSelection: true,
          accounts: [...publicAccount, ...connections.map((connection) => ({
            id: connection.id,
            label: accountLabel(connection),
            email: connection.email || null,
            authType: connection.authType || null,
            priority: connection.priority ?? null,
            isActive: connection.isActive !== false,
          }))],
        });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Failed to load model accounts" }, 500);
      }
    })
    .post("/chat/completions", async (c) => {
      const format = c.req.query("format") === "messages" ? "messages" : "responses";
      const source = format === "messages" ? "claude" as const : "responses" as const;
      const endpoint = format === "messages" ? "/v1/messages" : "/v1/responses";
      const body = await c.req.json<Record<string, unknown>>();
      // Playground traffic is already admin-authenticated; no API key needed.
      const headers = Object.fromEntries([...c.req.raw.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
      // The dashboard URL is not a public compatibility endpoint; retain the
      // explicit playground format instead of re-detecting it from this path.
      // Playground traffic counts against the global in-flight cap.
      return withAdmission(runtime, null, source, async () => {
        const dispatched = await dispatchChat(runtime, { body, source, endpoint, pathname: null, apiKey: null, clientIp: c.req.header("x-forwarded-for"), headers, userAgent: c.req.header("user-agent") || "", signal: c.req.raw.signal });
        return dispatched || runtime.gateway.chat({ body, source, endpoint, apiKey: null, clientIp: c.req.header("x-forwarded-for") });
      });
    })
    .post("/chat/tools", async (c) => {
      try {
        const body = await c.req.json<{ name?: unknown; arguments?: unknown }>().catch(() => ({}) as { name?: unknown; arguments?: unknown });
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        const result = await runTool(name, parseArguments(body?.arguments));
        return c.json({ ok: true, result });
      } catch (error: any) {
        const message = error instanceof Error ? error.message : "Tool execution failed";
        const status = message.startsWith("Unsupported dashboard tool") || message.includes("required") || message.includes("not allowed") || message.includes("must stay")
          ? 400
          : 500;
        return c.json({ ok: false, error: message }, status as 400 | 500);
      }
    });
}
