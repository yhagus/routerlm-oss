import { NotFoundException } from "@nestjs/common";

/** The 404 for an Integration id that names no Integration. */
export function integrationNotFound(): NotFoundException {
  return new NotFoundException("Integration not found");
}
