import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import { settings } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import {
  SETTING_DEFINITIONS,
  type SettingKey,
  settingValueSchema,
} from "../models/setting-definitions.js";

export interface SettingValue {
  value: number;
  isDefault: boolean;
}

/** Reads and writes Settings. Every read goes to the database, so a change applies without a restart. */
@Injectable()
export class SettingsStore {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async read(key: SettingKey): Promise<SettingValue> {
    const [row] = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key));
    const stored = settingValueSchema(key).safeParse(row?.value);
    if (!stored.success) {
      return { value: SETTING_DEFINITIONS[key].default, isDefault: true };
    }
    return { value: stored.data, isDefault: false };
  }

  async write(key: SettingKey, value: number): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  }

  /** Deletes the row, so the Setting follows its default again. */
  async reset(key: SettingKey): Promise<void> {
    await this.db.delete(settings).where(eq(settings.key, key));
  }
}
