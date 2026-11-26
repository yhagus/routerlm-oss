import { BadRequestException } from '@nestjs/common';
import { AUTO_PLAN_CHOICE, NO_PLAN_CHOICE, type providers } from '@/db/schemas';

type PlanOffer = Pick<typeof providers.$inferSelect, 'name' | 'plans' | 'allowsNoPlan'>;

function offeredPlanChoices(provider: PlanOffer): string[] {
  return [
    AUTO_PLAN_CHOICE,
    ...(provider.allowsNoPlan ? [NO_PLAN_CHOICE] : []),
    ...provider.plans.map((plan) => plan.value),
  ];
}

export function assertPlanChoiceOffered(provider: PlanOffer, planChoice: string): void {
  const offered = offeredPlanChoices(provider);
  if (!offered.includes(planChoice)) {
    const choices = offered.map((choice) => `"${choice}"`).join(', ');
    throw new BadRequestException(
      `${provider.name} offers no Plan Choice "${planChoice}"; choose one of ${choices}`,
    );
  }
}

export function planOf(account: { plan: string | null; planChoice: string }): string | null {
  if (account.planChoice === AUTO_PLAN_CHOICE) {
    return account.plan;
  }
  if (account.planChoice === NO_PLAN_CHOICE) {
    return null;
  }
  return account.planChoice;
}
