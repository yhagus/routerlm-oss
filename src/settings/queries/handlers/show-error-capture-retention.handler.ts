import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { toErrorCaptureRetention } from "../../models/error-capture-retention-view.js";
import type { ErrorCaptureRetention } from "../../models/error-capture-retention.js";
import { SettingsStore } from "../../providers/settings-store.js";
import { ShowErrorCaptureRetentionQuery } from "../impl/show-error-capture-retention.query.js";

@QueryHandler(ShowErrorCaptureRetentionQuery)
export class ShowErrorCaptureRetentionHandler implements IQueryHandler<ShowErrorCaptureRetentionQuery> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<ErrorCaptureRetention> {
    return toErrorCaptureRetention(await this.store.read("errorCaptureRetentionDays"));
  }
}
