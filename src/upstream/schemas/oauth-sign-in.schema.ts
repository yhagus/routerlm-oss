import { z } from "zod";
import { OAUTH_REGIONS } from "@/db/schemas/index.js";

/** What the dashboard sends to start a sign-in: the Provider, and where the User's account lives. */
export const newOauthSignInSchema = z.strictObject({
  providerId: z.uuid(),
  region: z.enum(OAUTH_REGIONS),
});
export type NewOauthSignIn = z.infer<typeof newOauthSignInSchema>;

/**
 * A sign-in as OauthSignInStore keeps it in Redis, from its start until a
 * while after it ended.
 */
export const storedOauthSignInSchema = z.object({
  providerId: z.uuid(),
  region: z.enum(OAUTH_REGIONS),
  /** Becomes the device id of the Provider Account the sign-in creates. */
  deviceId: z.string().min(1),
  /** Whoever holds the device code can collect the tokens, so it is stored as ciphertext. */
  encryptedDeviceCode: z.string().min(1),
  userCode: z.string().min(1),
  verificationUri: z.string().min(1),
  verificationUriComplete: z.string().min(1).nullable(),
  /** Epoch milliseconds. */
  expiresAt: z.number(),
  /** How long to wait between polls; `slow_down` lengthens it. */
  pollIntervalSeconds: z.number().positive(),
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("pending") }),
    z.object({ status: z.literal("completed"), providerAccountId: z.uuid() }),
    z.object({ status: z.literal("denied") }),
    z.object({ status: z.literal("expired") }),
  ]),
});
export type StoredOauthSignIn = z.infer<typeof storedOauthSignInSchema>;
