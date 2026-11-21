import { Command } from "@nestjs/cqrs";

/**
 * Deletes an Integration for good: revokes every API Key it issued first, so
 * nothing it issued keeps working, then removes it, which clears the keys'
 * link to it. Usage Logs keep its name (ADR 0024).
 */
export class DeleteIntegrationCommand extends Command<void> {
  constructor(readonly id: string) {
    super();
  }
}
