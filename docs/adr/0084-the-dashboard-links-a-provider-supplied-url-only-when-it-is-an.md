---
status: accepted
areas: [web]
---
# The dashboard links a Provider-supplied URL only when it is an http(s) address

The OAuth Login sign-in shows the Provider's verification page, a URL the Provider sends and the gateway relays.

We decided the dialog turns it into a link only when it matches `^https?://`; anything else is shown as text. A Provider-supplied value must not become a `javascript:` or other scheme link. This governs `WEB_ADDRESS` in `web/app/components/ProviderAccountSignInDialog.vue`.
