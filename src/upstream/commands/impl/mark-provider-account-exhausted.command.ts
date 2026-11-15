import { Command } from "@nestjs/cqrs";

/**
 * Makes a Provider Account Exhausted (GLOSSARY): routing skips it like a
 * Cooldown, until `until`. Replaces any Cooldown it is in. With `until` null,
 * nobody knows yet when its quota resets, so it is skipped for a short while,
 * until a quota reading sets the precise end.
 */
export class MarkProviderAccountExhaustedCommand extends Command<void> {
  constructor(
    readonly providerAccountId: string,
    readonly until: Date | null,
  ) {
    super();
  }
}
