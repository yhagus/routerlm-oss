# Providers are data, Protocols are code

Most Providers speak one of a few Protocols and differ only in base URL, authentication header, and small quirks. We decided that a Provider is a database row that names the Protocol it speaks, and the code holds one adapter per Protocol, not one per Provider. An operator can add another Provider that speaks a known Protocol from the dashboard, with no deploy.

## Consequences

- Each endpoint a company sells through is its own Provider (Moonshot and Kimi Code are two Providers), so a Provider Account always belongs to exactly one base URL.
- Provider quirks go into per-Provider configuration first. Code specific to one Provider is written only when configuration can't express the quirk.
- The Providers and Upstream Models that ship with the gateway live in the repo as Catalog data files. The seeder only creates what is missing and never overwrites an operator's edits. The one exception is filling an empty value: the seeder sets a Provider's logo, or an Upstream Model's name, Release Date, max output or price, when the stored one is empty, because there is no operator edit to lose.
