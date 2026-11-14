import { z } from "zod";

/**
 * A Chat Completions request body. The Chat Completions converter reads the
 * rest; the Playground only insists on a stream, which carries the summary.
 */
export const playgroundRequestSchema = z.looseObject({ stream: z.literal(true) });
export type PlaygroundRequest = z.infer<typeof playgroundRequestSchema>;
