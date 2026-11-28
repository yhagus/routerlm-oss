import { z } from 'zod';

export const waitingCallerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('api-key'),
    apiKeyId: z.string(),
    customer: z.object({ integrationId: z.string(), customerId: z.string() }).nullable(),
  }),
  z.object({ kind: z.literal('playground'), userId: z.string() }),
  z.object({ kind: z.literal('unidentified') }),
]);
export type WaitingCaller = z.infer<typeof waitingCallerSchema>;

export const waitsForSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('api-key'), apiKeyId: z.string() }),
  z.object({ kind: z.literal('provider-accounts'), providerAccountIds: z.array(z.string()) }),
]);
export type WaitsFor = z.infer<typeof waitsForSchema>;

export const waitingRequestDescriptorSchema = z.object({
  waitingSince: z.iso.datetime(),
  deadline: z.iso.datetime(),
  waitsFor: waitsForSchema,
  caller: waitingCallerSchema,
  requestedModelName: z.string().nullable(),
  isStreamed: z.boolean(),
  clientIp: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type WaitingRequestDescriptor = z.infer<typeof waitingRequestDescriptorSchema>;
export type WaitingRequester = Omit<
  WaitingRequestDescriptor,
  'waitingSince' | 'deadline' | 'waitsFor'
>;
