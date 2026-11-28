import { REQUEST_BODY_LIMIT } from '@/configure-app';
import { CHARACTERS_PER_TOKEN } from '@/inference/models/route-selection';

const BYTES_PER_UNIT: Record<string, number> = {
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

function bytesOf(size: string): number {
  const match = /^(\d+)(kb|mb|gb)$/i.exec(size);
  const unit = match?.[2]?.toLowerCase();
  const bytesPerUnit = unit === undefined ? undefined : BYTES_PER_UNIT[unit];
  if (match === null || bytesPerUnit === undefined) {
    throw new Error(`Cannot read the request body limit "${size}"`);
  }
  return Number(match[1]) * bytesPerUnit;
}

console.log(`export REQUEST_BODY_LIMIT_BYTES=${bytesOf(REQUEST_BODY_LIMIT)}`);
console.log(`export CHARACTERS_PER_TOKEN=${CHARACTERS_PER_TOKEN}`);
