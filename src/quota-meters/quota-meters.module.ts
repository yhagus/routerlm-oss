import { Module } from "@nestjs/common";
import { ProviderAccountQuotaController } from "./provider-account-quota.controller.js";
import { QuotaReadingModule } from "./quota-reading.module.js";

/** Dashboard access to Quota Meters: reading a Provider Account's meters now. */
@Module({
  imports: [QuotaReadingModule],
  controllers: [ProviderAccountQuotaController],
})
export class QuotaMetersModule {}
