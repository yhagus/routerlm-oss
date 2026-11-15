# RouterLM

A self-hosted AI model gateway: clients send inference requests in a standard format, and the gateway serves them from upstream providers the client never sees.

## Language

### People and access

**User**:
A person who logs in to the dashboard. Every User is an equal operator of the whole gateway.
_Avoid_: Account, admin, operator account

**API Key**:
A credential the gateway issues to a client application so it can call the inference endpoints.
_Avoid_: Token, client key, app key

### Upstream

**Provider**:
A company or service whose inference API the gateway calls, such as DeepSeek or Anthropic.
_Avoid_: Upstream, vendor, channel

**Provider Account**:
One API key the gateway holds at one Provider, with its own Quota Meters when it is a Subscription Provider.
_Avoid_: Account, credential, upstream key

**Subscription Provider**:
A Provider sold as a plan with usage limits rather than per-token prices, such as Kimi Code or MiniMax M Plan. Its pay-as-you-go counterpart is a separate Provider, such as Moonshot or MiniMax API.
_Avoid_: Coding plan, token plan, membership

**Quota Meter**:
One usage limit of a Provider Account at a Subscription Provider, such as a 5-hour or weekly window, with how much is used and when it resets.
_Avoid_: Quota, rate limit, usage limit

**Exhausted**:
The state of a Provider Account whose Quota Meter has run out. Like a Cooldown, it is skipped, but until the meter resets. An operator can let a Provider Account keep serving while Exhausted when the Provider bills the excess some other way, such as MiniMax Credits.
_Avoid_: Over quota, capped, rate-limited

**Upstream Model**:
A model as one Provider names and sells it.
_Avoid_: Provider model, backend model

**Release Date**:
The day a Provider made an Upstream Model available, written YYYY-MM-DD.
_Avoid_: Launch date, published date, last updated

**Capability**:
Something an Upstream Model can do that a request may need, such as vision, tools, reasoning or structured output.
_Avoid_: Feature, modality

**Cooldown**:
A period during which a Provider Account is skipped because it recently failed.
_Avoid_: Ban, circuit break, backoff

**Catalog**:
The Providers and Upstream Models, with their Capabilities and prices, that ship with the gateway.
_Avoid_: Master data, seed data

**Protocol**:
A wire format for inference requests and responses that a Provider or a client speaks.
_Avoid_: Format, dialect, API type

### Routing

**Model**:
A model name the gateway owns and exposes to clients, independent of any Provider.
_Avoid_: Alias, virtual model, model mapping

**Route**:
One entry in a Model's ordered list, pointing at one Upstream Model that can serve it.
_Avoid_: Target, mapping, fallback entry

**Fallback**:
Moving a request to the next Provider Account, and then to the next Route, after the current one fails.
_Avoid_: Failover, retry

**Attempt**:
One upstream call made to one Provider Account while serving a request. A request has one or more Attempts.
_Avoid_: Try, hop, upstream request

**Parameter Policy**:
The defaults, forced values, caps and system prompt an operator sets on a Model, optionally overridden per Route.
_Avoid_: Parameter control, model config

### Records

**Cost**:
What one request costs at the Upstream Model's prices at the time of the request. For a subscription Provider, those are the list prices of the matching pay-as-you-go API, so Cost is what the request would have cost there, not what was paid.
_Avoid_: Price, charge, bill

**Cache read**:
Input tokens a Provider serves from its prompt cache, at their own price. Grouped with Input.
_Avoid_: Cache hit, cached input

**Cache write**:
Tokens a Provider stores in its prompt cache, at their own price. Grouped with Output: Output = Write.
_Avoid_: Cache creation, cache miss

**Usage Log**:
The record of one inference request's measurements: tokens, cache counts, sizes, cost and timing. It never holds prompt or response content.
_Avoid_: Request log, history

**Error Capture**:
The stored headers and body of a failed request or failed Attempt, kept for a limited time so an operator can see why it failed.
_Avoid_: Error log, debug log

**Playground**:
The dashboard screen where a User sends test requests to a Model through the same path client requests take, or straight to one Upstream Model in a Direct Upstream Model test.
_Avoid_: Chat, tester, sandbox

**Direct Upstream Model test**:
A Playground request sent to one Upstream Model with no Model in between. It uses the Provider's enabled Provider Accounts with the same Fallback a Route gets, checks Capabilities, and applies no Parameter Policy. Its Usage Log has no Model and no Route.
_Avoid_: Raw test, upstream test
