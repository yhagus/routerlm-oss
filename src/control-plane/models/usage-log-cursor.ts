import { ControlPlaneError } from "./control-plane-error.js";

/**
 * Where an Integration's usage pull stands: the last pulled Usage Log's
 * writing transaction and sequence, both 64-bit integers kept as decimal
 * strings. Clients see it only encoded, as an opaque cursor.
 */
export interface UsageLogPosition {
  transactionId: string;
  sequence: string;
}

const ENCODED_POSITION = /^(\d{1,20}):(\d{1,19})$/;

export function cursorOf(position: UsageLogPosition): string {
  return Buffer.from(`${position.transactionId}:${position.sequence}`).toString("base64url");
}

export function positionOf(cursor: string): UsageLogPosition {
  const match = ENCODED_POSITION.exec(Buffer.from(cursor, "base64url").toString());
  if (!match) {
    throw new ControlPlaneError("INVALID_ARGUMENT", "Invalid cursor");
  }
  return { transactionId: match[1], sequence: match[2] };
}
