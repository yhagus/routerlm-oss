import { Command } from "@nestjs/cqrs";

/**
 * Suspends an Integration: its secret and its API Keys stop working, and
 * nothing is deleted. Disabling a disabled Integration keeps its first disable time.
 */
export class DisableIntegrationCommand extends Command<void> {
  constructor(readonly id: string) {
    super();
  }
}
