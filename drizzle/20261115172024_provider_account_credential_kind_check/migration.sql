-- Every existing row passes: until 20261115163307 each account had a key and
-- no token columns, and since then only a sign-in writes tokens, on accounts
-- it creates without a key. A row that fails was edited by hand, and stops
-- the migration rather than being guessed at.
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_credential_kind_check" CHECK (("credential_kind" = 'api-key'
          and "encrypted_key" is not null
          and "oauth_encrypted_access_token" is null
          and "oauth_encrypted_refresh_token" is null)
        or ("credential_kind" = 'oauth-login'
          and "encrypted_key" is null
          and "oauth_encrypted_access_token" is not null
          and "oauth_encrypted_refresh_token" is not null));