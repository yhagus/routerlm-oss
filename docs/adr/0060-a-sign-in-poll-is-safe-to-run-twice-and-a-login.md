---
status: accepted
areas: [upstream]
---
# A sign-in poll is safe to run twice, and a login that cannot be stored ends the sign-in

OAuth Login sign-in polling is one delayed queue job per poll (ADR 0012). A poll that fails is run again (three attempts, exponential backoff in `oauth-sign-in-polling.ts`), because no later poll is queued behind it and giving up would leave the sign-in pending until its code expires.

So `PollOauthSignInHandler` must be safe to run twice. The grant spends the device code, so the auth host would not say again that the sign-in was approved: if an earlier run created the Provider Account but could not record completion (Redis failed), the next run finds it by the device id generated for the sign-in (`providerAccountCreatedBy`), and a concurrent poll that created it first is handled the same way. Conversely, when the granted login cannot be stored, no later poll can make up for it, so the sign-in ends as denied and the User starts another. Each write is one statement, so a failure leaves no account and no login half made.
