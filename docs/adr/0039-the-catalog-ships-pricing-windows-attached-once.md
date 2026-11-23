# The Catalog ships Pricing Windows, attached once

ADR 0038 left Catalog-shipped Pricing Windows for later because the seed never changes existing rows (ADR 0003). DeepSeek's off-peak hours and the Alibaba Token Plan night discount are published schedules, so an operator should not have to type them in. We decided (2026-11-23) that a Catalog file may define Pricing Windows (`pricingWindows`: name, time zone, ranges) and that each chat Upstream Model may list Window Prices for them (`windowPrices`, in order), naming a window of its own file.

The seed creates a window that no row has the name of, enabled. It attaches a model's Catalog Window Prices only in two cases: the model was created in the same seed run, or the window was. Either way the Catalog is telling the database something new, so there is no operator edit to lose. A new attachment goes after the model's existing windows.

## Considered options

- Attaching whenever a model lacks the window: an operator who detached a window, or disabled it and edited its prices, would get it back on every boot.
- Attaching only to new models: deployments seeded before the Catalog knew a window would never get its prices.
- One shared windows file: the loader reads every Catalog file as one Provider, and a window belongs with the prices that use it.

## Consequences

- A window name is unique across the Catalog, like a Provider slug.
- An existing window is never changed: not its ranges, time zone or enabled flag. A Catalog correction to a schedule reaches only databases that don't have the window yet.
- Deleting a Catalog window, like deleting a Catalog Provider, brings it back on the next seed, attached again to every Catalog model that lists it. An operator who doesn't want it disables it instead.
- A window's name is how the seed finds it, so an operator who renames one gets a fresh copy of the Catalog's on the next seed.
