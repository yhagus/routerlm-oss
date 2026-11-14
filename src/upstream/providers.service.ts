import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc, eq } from "drizzle-orm";
import { hasPostgresErrorCode, UNIQUE_VIOLATION } from "../db/postgres-errors.js";
import type { Database } from "../db/relations.js";
import { providers, upstreamModels } from "../db/schema.js";
import { deleteUnlessRouted } from "./routed-models.js";
import { UpstreamChangeSignal } from "./upstream-change-signal.js";
import type { NewProvider, ProviderChanges } from "./upstream.schemas.js";

/** A Provider as the dashboard API returns it. It holds no secrets. */
export type Provider = typeof providers.$inferSelect;

@Injectable()
export class ProvidersService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly changeSignal: UpstreamChangeSignal,
  ) {}

  listProviders(): Promise<Provider[]> {
    return this.db.select().from(providers).orderBy(asc(providers.name));
  }

  async createProvider(newProvider: NewProvider): Promise<Provider> {
    try {
      const [created] = await this.db.insert(providers).values(newProvider).returning();
      await this.changeSignal.changed();
      return created;
    } catch (error) {
      if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
        throw new ConflictException(
          `A Provider with the slug "${newProvider.slug}" already exists`,
        );
      }
      throw error;
    }
  }

  async updateProvider(providerId: string, changes: ProviderChanges): Promise<Provider> {
    const [updated] = await this.db
      .update(providers)
      .set(changes)
      .where(eq(providers.id, providerId))
      .returning();
    if (!updated) {
      throw new NotFoundException("Provider not found");
    }
    await this.changeSignal.changed();
    return updated;
  }

  /** Deletes a Provider with its Provider Accounts and Upstream Models, unless a Route uses one of them. */
  async deleteProvider(providerId: string): Promise<void> {
    const [provider] = await this.db
      .select({ name: providers.name })
      .from(providers)
      .where(eq(providers.id, providerId));
    if (!provider) {
      throw new NotFoundException("Provider not found");
    }
    await deleteUnlessRouted(
      this.db,
      `The Provider ${provider.name}`,
      eq(upstreamModels.providerId, providerId),
      async () => {
        await this.db.delete(providers).where(eq(providers.id, providerId));
      },
    );
    await this.changeSignal.changed();
  }
}
