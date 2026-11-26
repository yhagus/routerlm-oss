---
status: accepted
areas: [web]
---
# DataTable derives row counts and expanded state itself around the table adapter

`web/app/components/DataTable.vue` wraps the table adapter and serves a client mode (no `rowCount`) and a server mode.

We decided the row total is counted in the component rather than passed through the adapter's `rowCount` option, because the adapter drops an option whose ref holds `undefined`, which client mode passes. Expanded rows are recorded as each change against what is shown, because the table drops a closed row's id instead of storing false; otherwise a group opened by the search would reopen as soon as it was closed in `UpstreamModelBrowser.vue`.

## Consequences

- Moving either back onto the adapter's own options breaks client mode and group closing.
