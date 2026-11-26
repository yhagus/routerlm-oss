import { z } from 'zod';
import { OAUTH_REGIONS } from '@/db/schemas';

export const newOauthSignInSchema = z.strictObject({
  providerId: z.uuid(),
  region: z.enum(OAUTH_REGIONS).optional(),
  providerAccountId: z.uuid().optional(),
});
export type NewOauthSignIn = z.infer<typeof newOauthSignInSchema>;

export const storedOauthSignInSchema = z.object({
  providerId: z.uuid(),
  region: z.enum(OAUTH_REGIONS).nullable(),
  providerAccountId: z.uuid().optional(),
  deviceId: z.string().min(1),
  encryptedDeviceCode: z.string().min(1),
  userCode: z.string().min(1),
  verificationUri: z.string().min(1),
  verificationUriComplete: z.string().min(1).nullable(),
  expiresAt: z.number(),
  pollIntervalSeconds: z.number().positive(),
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('pending') }),
    z.object({ status: z.literal('completed'), providerAccountId: z.uuid() }),
    z.object({ status: z.literal('denied') }),
    z.object({ status: z.literal('expired') }),
  ]),
});
export type StoredOauthSignIn = z.infer<typeof storedOauthSignInSchema>;
