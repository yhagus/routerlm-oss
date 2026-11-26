---
status: accepted
areas: [web]
---
# List filters live in the URL query and are written in one patch per tick

Filters, search and page on list pages are held in the URL (`web/app/composables/useQueryParam.ts`) so a refresh, a bookmark or a shared link restores them.

We decided that writes made in one tick are merged into a single `router.replace`: Clear filters sets several params at once and a filter change also resets the page, so separate replaces would each start from the old URL and undo the others. List state that a page builds its request from is read straight from the route (`useRouteQueryParam`), so params changed by one navigation (back or forward to `?q=a&page=3`) change together and the request runs once with both; separate copies updated one by one would each trigger it.
