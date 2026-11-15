/** A day, such as "Nov 16, 2026": when a record was created or last used. */
export const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** A day and time to the second, such as "Nov 16, 2026, 2:05:09 PM": when a request ran. */
export const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});
