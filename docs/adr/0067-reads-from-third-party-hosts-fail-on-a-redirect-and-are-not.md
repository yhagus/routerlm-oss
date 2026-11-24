# Reads from third-party hosts fail on a redirect and are not retried

The gateway reads models.dev for Catalog Gaps and each Provider's quota endpoint for Quota Meters. Both reads go through a dedicated HTTP client (`MODELS_DEV_HTTP_CLIENT` in `src/catalog/catalog-gaps.module.ts`, `QUOTA_READER_HTTP_CLIENT` in `src/quota-meters/quota-meters.module.ts`).

We decided that these clients set `redirect: "error"` and `retry: false`. A redirect fails rather than carry the request, and for a quota reader the Provider Account's key, to another host. A failed read is not retried because the next request or the next scheduled reading is the retry; a failed read costs at most the timeout. The quota client also has no base URL: each reader builds the full URL from its Provider's base URL or the `quotaBaseUrl` quirk.

## Consequences

- A Provider that moves its quota endpoint behind a redirect shows a quota error until its Catalog data or `quotaBaseUrl` is corrected.
