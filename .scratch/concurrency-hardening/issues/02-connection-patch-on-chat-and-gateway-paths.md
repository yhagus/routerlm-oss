# 02: Connection patch on the chat and gateway paths

**What to build:** A request that waits on a slow Provider can end after other requests changed the same Connection. When it ends, it writes only the fields it changed. New Credentials, cooldowns, and model locks that other requests wrote stay in place. This ticket adds the patch method (expand) and moves the chat and gateway request paths to it (first migrate batch).

**Blocked by:** None (can start immediately)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Connection patch method).

- [ ] The Connection repository has a patch method. It reads the current cached row, merges the given fields, and writes the row with no `await` between read and write.
- [ ] The patch method merges nested provider-specific data with its current value. A field set to `null` clears the field.
- [ ] A patch removes any pending deferred write for that Connection, or the deferred write uses the merged cache state at flush time. A deferred last-used write never overwrites a newer patch.
- [ ] The gateway success path, both gateway error paths, and the chat project-id hydration use the patch method and send only changed fields.
- [ ] The full-update method stays for dashboard edits that replace a Connection on purpose.
- [ ] Test (HTTP seam): a slow request starts, another actor stores new access and refresh tokens, then the slow request ends with success. The stored Connection keeps the new tokens.
- [ ] Test (HTTP seam): a slow request ends with success after another request wrote a cooldown on a different field set. Only error fields change. Credentials stay the same.
- [ ] Test (HTTP seam): a slow request ends with an error. The stored Connection keeps tokens written during the wait.

## Comments

Implementer note: `providers.patch(id, { data?, isActive? })` merges over the cached row with no await; `null` deletes a key, `undefined` is skipped; `providerSpecificData` merges one level deep. Error fields cleared on success are now removed instead of stored as null. Gateway 401 refresh write and `persistRefresh` stay for ticket 03.
