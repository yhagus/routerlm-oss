# Secrets typed in forms use a masked text input, not a password input

The dashboard asks for secrets in forms (for example a Provider's API key). A `type="password"` input makes browsers offer to save and fill logins, which is wrong for a Provider credential typed into a settings dialog.

We decided to render such fields as a plain text input with the `.text-input--masked` class (`-webkit-text-security: disc` in `web/app/assets/css/dashboard.css`), which shows dots without triggering the browser's password manager. A future cleanup must not switch these fields to `type="password"`.

The same holds for the API key field of the Provider Account form (`web/app/components/ProviderAccountsPanel.vue`): browsers and password managers offer saved logins for any password input, whatever its `autocomplete` attribute says. Changing such a field to `type="password"` brings the saved-login prompt back.
