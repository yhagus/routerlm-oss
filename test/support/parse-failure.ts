import { GatewayError } from "../../src/inference/gateway-error.js";
import type { ClientProtocolConverter } from "../../src/inference/protocols/client-protocol-converter.js";

/** The error a client converter refuses `body` with; fails the test if it accepts it. */
export function parseFailureOf(converter: ClientProtocolConverter, body: unknown): GatewayError {
  try {
    converter.parseRequest(body);
  } catch (error) {
    if (error instanceof GatewayError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the request to be refused");
}
