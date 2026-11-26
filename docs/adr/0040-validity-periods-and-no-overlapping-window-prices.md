---
status: accepted
areas: [pricing-windows, catalog]
---
# Validity Periods live on Window Prices, and a model's Window Prices never overlap

Providers run limited-time sales, such as 50% off one model until the end of the month, and a Pricing Window had no way to end. We decided (2026-11-23) that each Upstream Model's Window Prices may carry a Validity Period: an optional start and end, each a date and time in the window's time zone, start inclusive and end exclusive, a missing bound being open-ended. A sale is Window Prices on a window that covers the whole week with a Validity Period that ends; the window form has an "Always" preset (every weekday, `00:00`-`24:00`) for that. We also decided that at most one of a model's Window Prices can apply at any moment, which replaces the order rule of ADR 0038: two attachments on one model whose weekly hours overlap and whose Validity Periods overlap are rejected. The same window may be attached to a model several times, for Validity Periods that don't overlap.

Replacing an Upstream Model's Pricing Windows locks the model row and the attached Pricing Window rows in the same transaction as the overlap check, so a concurrent Kind change, deletion or reschedule cannot slip in between the check and the write.

Attachments are sorted in code, not in SQL, because the stored starts are wall-clock text in each window's own time zone, so only their instants compare across zones.

## Considered options

- A Validity Period on the Pricing Window: one shared "Whole Week" window could then carry only one sale at a time, so every sale would need its own window. Sales are usually per model, and the window stays reusable master data.
- Keeping overlaps and letting the model's order decide (ADR 0038): with dated sales on top of open-ended off-peak windows, which price applies at a given moment could no longer be read off the model's page.
- Keeping existing overlaps after the upgrade, settled by the old order: it would keep `position` alive only for legacy rows.
- A percentage on the attachment: rejected for the same reason ADR 0038 rejected multipliers. Prices stay absolute; a "−50%" label is computed from the standard price for display only.

## Consequences

- The overlap check compares every attachment on the model, whatever its window, and counts disabled windows, so re-enabling one never fails. Two ranges in different time zones overlap if they share any moment within their shared Validity Period, DST changes included.
- `position` and the reorder UI are removed; attachments list by the instant their Validity Period starts (open start first), then window name. When a new attachment collides with an open-ended one, the form offers to split it: end the existing one where the new one starts and attach it again from where the new one ends. The form treats windows in different time zones as possibly colliding and leaves the exact check to the API, so it may offer a split the API wouldn't need.
- Editing a window's ranges or time zone is rejected when it would create an overlap on any Upstream Model that attaches it, naming those models.
- Whether Window Prices are Scheduled, Active now, Window closed (inside their Validity Period while their window isn't active) or Expired is computed from the clock. Nothing disables itself when its period ends; the operator deletes it.
- `ListModels` (ADR 0033) gives each window entry its Validity Period as optional ISO 8601 timestamps with an offset, and leaves out entries whose period has ended.
- The migration fails and lists the conflicts when a deployment already has overlapping attachments; the operator resolves them before upgrading.
- The Catalog ships no Validity Periods and no "Whole Week" window (ADR 0039 is unchanged). The seed skips and logs a Catalog attachment that would overlap one an operator added.
