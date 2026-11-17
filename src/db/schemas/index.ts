// Drizzle schema entry point, read by both the app (via relations.ts) and
// drizzle-kit (drizzle.config.ts). Tables live in this folder, grouped like the
// sections of GLOSSARY.md. After changing one, run `bun run db:generate`.
export * from "./access.js";
export * from "./upstream.js";
export * from "./routing.js";
export * from "./records.js";
export * from "./settings.js";
