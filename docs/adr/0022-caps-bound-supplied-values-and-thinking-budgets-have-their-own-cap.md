# Caps bound supplied values, and thinking budgets have their own Cap

A security audit asked two things of the Parameter Policy. Does a Cap apply when the client omits the parameter? And does the reasoning effort Cap bind Anthropic `thinking.budget_tokens`, which skipped it because a budget carries no effort? We decided:

- A **Cap** (see the glossary) is a ceiling on a value the client or a default supplies. It never invents a value, so an omitted parameter with no default stays omitted. An operator who wants a value in that case sets a default beside the Cap. The dashboard warns when a Cap has no default.
- `caps.reasoningEffort` bounds effort only. A new `caps.reasoningBudgetTokens` bounds a thinking budget, taking the lower of the client's budget and the Cap.

## Considered Options

- A Cap that fills an omitted parameter with its own value. Rejected: it changes the meaning of a default, and for a parameter like temperature it replaces the Provider's default with a value the operator only meant as a ceiling.
- Mapping effort tiers to token budgets so the effort Cap binds budgets. Rejected: it hides arbitrary numbers in code, and a tier means different things at different Providers.

## Consequences

- An operator who relies on an effort Cap for spend on an anthropic-messages Route must also set the budget Cap; the dashboard shows both.
- The Parameter Policy schema, its merge rules for Route overrides, and the dashboard form gain one field.
- The warning for a Cap without a default is a dashboard hint, not a validation error.
