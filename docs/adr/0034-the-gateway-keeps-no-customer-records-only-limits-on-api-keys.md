---
status: accepted
areas: [spend-limits, api-keys]
---
# The gateway keeps no Customer records, only Spend Limits and Request Rates on API Keys

An Integration that resells inference needs its Customers stopped when they run out of money, and kept from flooding the Provider Accounts that every Customer shares. The obvious design is a Customer table with a prepaid balance that the gateway debits. We decided the gateway stores nothing about a Customer except the id its Integration gives it, written on each API Key (fixed once the key exists) and copied into the Usage Logs and Error Captures of that key's requests. Money, balances, plans and prices to Customers stay in the Integration.

What the gateway enforces instead are two limits on any API Key, both nullable (null means unlimited), and available to keys a User creates as well:

- **Spend Limit**: the most Cost the key may run up. The Integration sets it as an absolute value, so a top-up is "set the limit to X", which is idempotent without a ledger of grants. Once spent reaches it, new requests get a 402 with `spend_limit_reached` and Error Origin Client. Requests already running may finish past it.
- **Request Rate**: the most requests per minute, refused with a 429.

402 rather than 429 for the Spend Limit because the OpenAI and Anthropic SDKs retry a 429 on their own, which would hammer the gateway for something that will not succeed.

An Integration also has a ceiling of allowed Models; its keys' allowed Models must sit within it.

## Considered Options

- A Customer table with a balance and idempotent grants. Rejected: that is billing state, which belongs to the Integration, and it would make the gateway the system of record for money.
- A Customer balance cached in Redis, owned by the Integration. Rejected: still business state in the gateway, and lost or stale whenever Redis is.
- Asking the Integration synchronously before each request. Rejected: an outside call on the hot path, and inference stops whenever the Integration is down.

## Consequences

- A Customer whose one balance covers several API Keys must have it split across their Spend Limits by the Integration, or be given one key.
- Disabling an Integration revokes its secret and refuses all its keys without deleting them; deleting it for good is a separate action.
- A User can revoke an Integration's key from the dashboard in an emergency, but its limits and Models are the Integration's to change.
