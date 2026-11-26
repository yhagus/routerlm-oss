import { Injectable } from '@nestjs/common';
import type { PlanReaderName } from '@/db/schemas';
import type { PlanReader } from '@/plans/models/plan-reader';
import { TokenHarborPlanReader } from './tokenharbor-plan-reader';

@Injectable()
export class PlanReaders {
  private readonly readers: Record<PlanReaderName, PlanReader>;

  constructor(tokenHarbor: TokenHarborPlanReader) {
    this.readers = { tokenharbor: tokenHarbor };
  }

  readerFor(name: PlanReaderName): PlanReader {
    return this.readers[name];
  }
}
