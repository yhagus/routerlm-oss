# Pricing Windows hold schedules, Upstream Models hold the prices

Status: accepted, amended by ADR 0040: Window Prices may carry a Validity Period, and a model's Window Prices may no longer overlap, so the model's order and the "first active window wins" rule are gone.

Some Providers charge less at set hours: DeepSeek charges half price outside its weekday peak hours (01:00-04:00 and 06:00-10:00 UTC), and ClinePass passes on the same peak and off-peak prices. Until now the Catalog has stored only the peak price, so Cost was never understated but was often overstated. We decided that a Pricing Window is a named weekly schedule with no prices: weekday-and-time ranges in one IANA time zone, plus an enabled flag. Each chat Upstream Model that attaches a window gives its own partial Window Prices. A model can attach several windows in an order it chooses, and the first active enabled window wins. The time the gateway received the request decides which window is active.

## Considered options

- A multiplier on the window (×0.5) applied to every attached model: Providers round their prices and sometimes discount only some of them, such as cache read but not output, so absolute prices per model are the only exact form.
- Rejecting overlapping windows on one model: weekly ranges in different time zones overlap differently across DST changes, so an explicit order is simpler and predictable.
- The cheapest active window wins: it hides the operator's intent and makes Cost hard to predict when reading the model's page.

## Consequences

- A request that asks for a Service Tier ignores windows completely: tier prices apply, falling back to the standard prices, never to Window Prices. A tier is something the client asked for on purpose; a window discounts the default. If a Provider ever discounts a tier off-peak, Window Prices can gain their own tier prices then.
- A range that crosses midnight belongs to the weekday it starts on. `24:00` is allowed as an end time so a range can cover a whole day. A range's start never equals its end.
- Deleting a window removes its Window Prices from every Upstream Model. Disabling it keeps them but stops them from applying. Past Usage Logs keep their Cost and a snapshot of the window's name (ADR 0024).
- Integrations see windows on a Model in `ListModels` (ADR 0033), taken from the same first usable Route as the Model's standard prices: the time zone, the ranges and the four token prices, with any price left out already filled in with the standard one. They never get the window's name or id, because an operator's name such as "DeepSeek Off-Peak" would reveal the Provider the contract promises to hide. There is no "active now" field, because Integrations cache the listing.
- Windows cover token prices only. Media unit prices are left for later. Catalog-shipped windows came later in ADR 0039.
