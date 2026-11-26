---
status: accepted
areas: [overview]
---
# The Overview bucket interval is inlined as a SQL literal

`ShowOverviewHandler` buckets Usage Logs with `date_bin`. We decided to render the interval as a SQL literal instead of a bound parameter, so the SELECT and the GROUP BY render the same expression and PostgreSQL accepts the grouping. This is safe because `bucketSeconds` always comes from `OVERVIEW_BUCKETS`, never from request input. Turning it into a parameter breaks the GROUP BY.
