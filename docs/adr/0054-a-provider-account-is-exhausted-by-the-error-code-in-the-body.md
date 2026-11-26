---
status: accepted
areas: [inference]
---
# A Provider Account is Exhausted by the error code in the body, whatever the HTTP status

Some Providers do not signal Exhausted with a status. MiniMax may refuse an Exhausted Provider Account with HTTP 200 and an error code in the body, and its Anthropic-compatible endpoint puts the code at the end of the message only, such as "usage limit exceeded, ... resets at <time> (2056)". We decided that `UpstreamClient` reads the body of a 200 answer for the Provider's `exhaustedErrorCodes` quirk, and `quota-exhausted-error.ts` looks for codes in the usual fields and in the message tail. A 200 is therefore not proof of success for these Providers.
