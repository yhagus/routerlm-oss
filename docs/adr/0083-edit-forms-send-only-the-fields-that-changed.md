# Edit forms send only the fields that changed

The dashboard edits API Keys and Integrations through forms that could resend every field. An API Key can be expired, and its past expiry sent back unchanged would be read by the backend as a new, invalid expiry.

We decided that an edit sends only the fields the operator changed, so an expired key's past expiry is never sent back as if it were new. The form computes the changed fields and sends an empty edit as nothing. This governs `web/app/components/ApiKeyFormDialog.vue` and `web/app/components/IntegrationFormDialog.vue`.

## Consequences

- A form must not be simplified to post its whole state: editing the name of an expired API Key would then fail.
