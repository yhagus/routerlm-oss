import { NotFoundException } from '@nestjs/common';

export function integrationNotFound(): NotFoundException {
  return new NotFoundException('Integration not found');
}
