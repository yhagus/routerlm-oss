// Stages the publishable `routerlm` package in cli/dist:
//   cli.js, src/          launcher + connect/show commands
//   app/backend/src       Bun backend, run as-is by the bundled Bun
//   app/frontend/dist     built dashboard (run `bun run build:frontend` first)
//   package.json          cli/package.json + version + the backend's runtime deps
//
// Usage: node cli/scripts/build.mjs [version]   (default: root package.json version)

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(cliDir, "..");
const out = join(cliDir, "dist");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const rootPkg = readJson(join(root, "package.json"));
const backendPkg = readJson(join(root, "backend", "package.json"));
const template = readJson(join(cliDir, "package.json"));

const version = (process.argv[2] || rootPkg.version).replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid version "${version}"`);

const frontendDist = join(root, "frontend", "dist");
if (!existsSync(join(frontendDist, "index.html"))) {
  throw new Error("frontend/dist is missing. Run `bun run build:frontend` first.");
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

// Package names imported anywhere in backend/src. Only these ship, so packages
// listed in backend/package.json but never imported stay out of global installs.
function importedPackages() {
  const builtins = new Set(builtinModules);
  const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"'./][^"']*)["']/gm;
  const names = new Set();
  for (const file of walk(join(root, "backend", "src"))) {
    if (!file.endsWith(".ts")) continue;
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(pattern)) {
      if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun") continue;
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      if (!builtins.has(name)) names.add(name);
    }
  }
  return [...names].sort();
}

const backendDeps = { ...backendPkg.dependencies, ...backendPkg.optionalDependencies };
const runtimeDeps = {};
for (const name of importedPackages()) {
  if (!backendDeps[name]) throw new Error(`backend/src imports "${name}", which backend/package.json does not list`);
  runtimeDeps[name] = backendDeps[name];
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(join(cliDir, "cli.js"), join(out, "cli.js"));
cpSync(join(cliDir, "src"), join(out, "src"), { recursive: true });
cpSync(join(cliDir, "README.md"), join(out, "README.md"));
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));
cpSync(join(root, "backend", "src"), join(out, "app", "backend", "src"), { recursive: true });
cpSync(frontendDist, join(out, "app", "frontend", "dist"), { recursive: true });

// The backend reads its own package.json for the version it reports.
writeFileSync(
  join(out, "app", "backend", "package.json"),
  `${JSON.stringify({ name: backendPkg.name, version, private: true, type: "module" }, null, 2)}\n`,
);

const { comment_build: _comment, ...manifest } = template;
manifest.version = version;
manifest.dependencies = { ...runtimeDeps, ...template.dependencies };
writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${manifest.name}@${version} in ${out}`);
console.log(`Backend runtime deps: ${Object.keys(runtimeDeps).join(", ")}`);
