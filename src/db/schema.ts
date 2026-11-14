// Drizzle schema entry point, read by both the app (via relations.ts) and
// drizzle-kit (drizzle.config.ts). Tables live in ./schema/, grouped like the
// sections of GLOSSARY.md. After changing one, run `bun run db:generate`.
export * from "./schema/access.js";
export * from "./schema/upstream.js";
export * from "./schema/routing.js";
export * from "./schema/records.js";
