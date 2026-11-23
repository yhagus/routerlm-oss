import { z } from "zod";
import type { IsoWeekday, PricingWindowRange } from "@/db/schemas/index.js";
import { hasAnyField, nothingToChange } from "@/libs/schemas/partial-update.schema.js";

// What the dashboard sends to create or change Pricing Windows and to attach
// them to an Upstream Model.

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_OF_DAY = "24:00";

const weekdaySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]) satisfies z.ZodType<IsoWeekday>;

const rangeSchema = z
  .strictObject({
    weekdays: z
      .array(weekdaySchema)
      .min(1, { error: "A range needs at least one weekday" })
      .refine((weekdays) => new Set(weekdays).size === weekdays.length, {
        error: "List each weekday once",
      }),
    start: z.string().regex(TIME_OF_DAY, { error: "Write the start as HH:MM" }),
    end: z.string().refine((end) => end === END_OF_DAY || TIME_OF_DAY.test(end), {
      error: "Write the end as HH:MM, or 24:00",
    }),
  })
  // `00:00` to `24:00` is a whole day, so only the same spelling is refused.
  .refine((range) => range.start !== range.end, {
    error: "A range's start can't equal its end",
  }) satisfies z.ZodType<PricingWindowRange>;

/** Whether `timeZone` is an IANA time zone name, such as `Asia/Shanghai` or `UTC`. */
function isIanaTimeZone(timeZone: string): boolean {
  // The engine also accepts offsets such as `+08:00`, which are no IANA name.
  if (!/^[A-Za-z]/.test(timeZone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const pricingWindowFieldsSchema = z.strictObject({
  name: z.string().trim().min(1),
  timeZone: z.string().refine(isIanaTimeZone, { error: "Unknown time zone" }),
  ranges: z.array(rangeSchema).min(1, { error: "A Pricing Window needs at least one range" }),
  isEnabled: z.boolean(),
});

export const newPricingWindowSchema = pricingWindowFieldsSchema.extend({
  isEnabled: z.boolean().optional(),
});
export type NewPricingWindow = z.infer<typeof newPricingWindowSchema>;

export const pricingWindowChangesSchema = pricingWindowFieldsSchema
  .partial()
  .refine(hasAnyField, nothingToChange);
export type PricingWindowChanges = z.infer<typeof pricingWindowChangesSchema>;

/** USD per million tokens; left out or null, the standard price applies. */
const windowPriceSchema = z.number().nonnegative().nullable().optional();

const windowPricesEntrySchema = z
  .strictObject({
    pricingWindowId: z.uuid(),
    inputPrice: windowPriceSchema,
    outputPrice: windowPriceSchema,
    cacheReadPrice: windowPriceSchema,
    cacheWritePrice: windowPriceSchema,
  })
  .refine(
    (entry) =>
      [entry.inputPrice, entry.outputPrice, entry.cacheReadPrice, entry.cacheWritePrice].some(
        (price) => price !== undefined && price !== null,
      ),
    { error: "Give the Pricing Window at least one price" },
  );
export type WindowPricesEntry = z.infer<typeof windowPricesEntrySchema>;

/** An Upstream Model's whole ordered list of Pricing Windows: the first active one wins. */
export const windowPricesListSchema = z
  .array(windowPricesEntrySchema)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.pricingWindowId)).size === entries.length,
    { error: "Attach each Pricing Window once" },
  );
