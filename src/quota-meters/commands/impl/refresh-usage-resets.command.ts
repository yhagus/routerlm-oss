import { Command } from "@nestjs/cqrs";

/**
 * Fetches a Provider Account's list of Usage Resets and replaces the stored
 * ones with it (ADR 0041). Does nothing when its Provider has no Usage
 * Resets. A failed fetch keeps the stored resets and is logged; it never throws.
 */
export class RefreshUsageResetsCommand extends Command<void> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
