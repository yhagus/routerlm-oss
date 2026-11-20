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

**Terms Risk**:
A flag on a Provider whose documented terms the gateway's use may breach, such as a plan limited to interactive use by one person. While the "allow terms-risk providers" Setting is off (the default), such a Provider is unusable: no inference, not listed to clients, though its own enabled flag is untouched.

**Provider Account**:
One credential the gateway holds at one Provider, either an API key or an OAuth Login, with its own Quota Meters when it is a Subscription Provider.
_Avoid_: Account, credential, upstream key

**OAuth Login**:
A sign-in to a Provider that a User grants the gateway, which the gateway keeps valid on its own. It is one of the two credentials a Provider Account can hold, the other being an API key.
_Avoid_: Token, session, OAuth account

**Subscription Provider**:
A Provider sold as a plan with usage limits rather than per-token prices, such as Kimi Code, MiniMax M Plan or OpenAI Codex. Its pay-as-you-go counterpart is a separate Provider, such as Moonshot, MiniMax API or OpenAI.
_Avoid_: Coding plan, token plan, membership

**Quota Meter**:
One usage limit of a Provider Account at a Subscription Provider, such as a 5-hour or weekly window, with how much is used and when it resets. A meter may apply to only one Model Kind, such as an image generation limit.
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

**Catalog Gap**:
An Upstream Model that models.dev lists among a Provider's newest models but the Catalog does not yet hold.
_Avoid_: Missing model, new model, diff

**Capability**:
Something an Upstream Model can do that a request may need, such as vision, tools, reasoning or structured output.
_Avoid_: Feature, modality

**Model Kind**:
What an Upstream Model or a Model does: chat (text, reasoning and tool calls), image (generates or edits images), video (generates a video), speech (reads text aloud), transcription (turns recorded audio into text) or realtime (a live two-way voice conversation). A Model's Routes all point at Upstream Models of its Kind, and it only serves requests of its Kind.
_Avoid_: Modality, model type, endpoint type

**Service Tier**:
The speed or priority class an Attempt asks a Provider for, such as fast or flex, which can cost more money or quota than the default. Each Provider accepts its own set of Service Tiers, or none.
_Avoid_: Fast mode, priority, speed mode

**Cooldown**:
A period during which a Provider Account is skipped because it recently failed.
_Avoid_: Ban, circuit break, backoff

**Catalog**:
The Providers and Upstream Models, with their Capabilities and prices, that ship with the gateway. A Catalog Gap is only reported, never added automatically.
_Avoid_: Master data, seed data

**Protocol**:
A wire format for inference requests and responses that a Provider or a client speaks. A Provider speaks at most one Protocol per Model Kind, each at its own address, all with the same Provider Account.
_Avoid_: Format, dialect, API type

### Routing

**Model**:
A model name the gateway owns and exposes to clients, independent of any Provider.
_Avoid_: Alias, virtual model, model mapping

**Route**:
One entry in a Model's ordered list, pointing at one Upstream Model that can serve it.
_Avoid_: Target, mapping, fallback entry

**Video Job**:
One video generation a client submits and later polls for. Fallback applies only when it is submitted; afterwards it stays with the Provider Account that accepted it, until it finishes or the Provider forgets it.
_Avoid_: Task, video request, generation

**Fallback**:
Moving a request to the next Provider Account, and then to the next Route, after the current one fails.
_Avoid_: Failover, retry

**Attempt**:
One upstream call made to one Provider Account while serving a request. A request has one or more Attempts.
_Avoid_: Try, hop, upstream request

**Parameter Policy**:
The defaults, forced values, caps and system prompt an operator sets on a Model, optionally overridden per Route.
_Avoid_: Parameter control, model config

**Cap**:
A ceiling in a Parameter Policy on a value the client or a default supplies. It lowers a value that is too high and never invents one: when the client omits the parameter and no default is set, the parameter stays omitted and the Provider's own default applies. A reasoning effort Cap bounds effort only; a thinking budget has its own Cap.
_Avoid_: Limit, max, clamp

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
The record of one inference request's measurements: tokens or, for Model Kinds priced otherwise, the counted units (images, seconds, characters), cache counts, sizes, cost and timing, who sent it and from where (User-Agent and IP address), and what served it as it was at that moment. Editing or deleting a Model, Route, Upstream Model, Provider Account, API Key or User afterwards never changes it. It never holds prompt or response content.
_Avoid_: Request log, history

**Time to First Token**:
How long a streamed request waited, from the gateway receiving it, until the first event that carries output: text, reasoning or a tool call. Events with no output, such as a stream's opening message, don't count. It includes any failed Attempts before the one that served it.
_Avoid_: TTFT alone in prose, latency

**Output Speed**:
Output tokens per second while a streamed response is being generated, after its Time to First Token. Reasoning tokens count only when they were streamed; hidden reasoning happens before the first output and is left out. Only successful, complete, uncancelled streamed requests with enough output to measure have one.
_Avoid_: TPS, throughput, tokens per second

**Finish Reason**:
Why a successful response stopped, in the gateway's own words whatever the Provider called it: it finished, it hit the output limit, it called a tool, or the Provider filtered it.
_Avoid_: Stop reason, end reason

**Error Origin**:
Whose side caused a failed request: the Client (the gateway refused the request), an Upstream (a Provider failed or refused it), or the Gateway (a fault in the gateway itself). A cancelled request has none.
_Avoid_: Error source, error side, fault, blame

**Error Capture**:
The stored headers and body of a failed request or failed Attempt, kept for a limited time so an operator can see why it failed.
_Avoid_: Error log, debug log

**Retention Period**:
How many days an Error Capture is kept before it is deleted. It is a Setting, 7 days until a User changes it.
_Avoid_: TTL, expiry, purge window

**Setting**:
A configuration value a User changes from the dashboard, kept in the database so a change takes effect without a restart.
_Avoid_: Config, option, preference

**Playground**:
The dashboard screen where a User sends test requests to a Model through the same path client requests take, or straight to one Upstream Model in a Direct Upstream Model test.
_Avoid_: Chat, tester, sandbox

**Direct Upstream Model test**:
A Playground request sent to one Upstream Model with no Model in between. It uses the Provider's enabled Provider Accounts with the same Fallback a Route gets, checks Capabilities, and applies no Parameter Policy. Its Usage Log has no Model and no Route.
_Avoid_: Raw test, upstream test

**Probe**:
A one-click check that one Upstream Model answers a fixed minimal request with each of its Provider's enabled Provider Accounts, giving one result per Provider Account. It tells whether the address, the credential and the model name work, not how well the model answers. It ignores Cooldown and Exhausted, never starts or clears either, and its results are not kept, though its Usage Logs and Error Captures are.
_Avoid_: Health check, ping, connection test
