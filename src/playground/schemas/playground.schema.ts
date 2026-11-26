import { z } from 'zod';

export const playgroundRequestSchema = z.looseObject({ stream: z.literal(true) });
export type PlaygroundRequest = z.infer<typeof playgroundRequestSchema>;
