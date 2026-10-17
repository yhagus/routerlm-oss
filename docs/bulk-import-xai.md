# Bulk Import xAI (Grok) OAuth Tokens to LobakAI

## Overview

This implementation adds bulk OAuth token import capability to LobakAI for xAI/Grok accounts. Users can now import multiple pre-authenticated Grok Build CLI sessions instantly, with each account automatically validated against x.ai API endpoints.

## Features

✅ **Instant Connection Testing** - Each imported account is tested immediately  
✅ **Bulk Processing** - Import JSON arrays of OAuth tokens  
✅ **Email Extraction** - Automatic email extraction from id_token  
✅ **Token Refresh Support** - Preserves refresh_tokens for automatic renewal  
✅ **Error Reporting** - Detailed per-account validation errors  
✅ **Failed Account Export** - Download failed imports as report  
✅ **Dashboard Integration** - UI modal in providers page  
✅ **API Endpoint** - RESTful POST endpoint for programmatic use  

## Quick Start

### Option 1: Via Dashboard UI

1. Open LobakAI dashboard: `http://localhost:20128`
2. Navigate to **Providers → OAuth Providers**
3. Find **xAI (Grok)** card
4. Click **"Bulk Import"** button below it
5. Paste or upload your tokens JSON file
6. Preview and confirm import
7. Wait for instant validation
8. Check results table

### Option 2: Via API

```bash
curl -X POST http://localhost:20128/api/oauth/xai/bulk-import \
  -H "Content-Type: application/json" \
  -d '{
    "tokens": [
      {
        "accessToken": "eyJhbGciOiJSUzI1NiIs...",
        "refreshToken": "dGhpcyBpcyBub3QgYSByZWFsIHJlZnJlc2gg...",
        "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IkFBQUE..."
      },
      ...
    ]
  }'
```

### Option 3: Via Test Script

```bash
# Generate test tokens from cloakbrowser session
node scripts/test-bulk-import.js
```

## Input Format

### Token Object Structure

```json
{
  "accessToken": "string",    // OAuth access token (JWT format)
  "refreshToken": "string",   // Refresh token for renewal
  "idToken": "string"         // JWT containing user info
}
```

### Array Format

```json
[
  {
    "accessToken": "eyJhbGc...RzI1NiJ9...",
    "refreshToken": "at_2aAbbcDdeFFghIjkKLmNoPpqrsTUvwxyYZABcDefGHij",
    "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IkFBQUEifQ.eyJlbWFpbCI6InVzZXJAZ21haWwuY29tIn0.signature"
  },
  {
    "accessToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IkJCQiIsIm...RzI1NiJ9...",
    "refreshToken": "...",
    "idToken": "..."
  }
]
```

### Example JSON File

Save as `grok-tokens.json`:

```json
[
  {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiZW1haWwiOiJqb2huQGdtYWlsLmNvbSIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    "refreshToken": "AT-AAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB-CCCCCCCCCCCCCCCCDDDDDDDDDDDDDDEEEEEEEEEFFFF",
    "idToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InVzZXIxQGdtYWlsLmNvbSIsIm5hbWUiOiJVc2VyIE9uZSJ9.signature_here"
  },
  {
    "accessToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IlhBWSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ODc2NTQzMjEwIiwibmFtZSI6IkpvdGUgU21pdGgiLCJlbWFpbCI6ImpvdGVAZ21haWwuY29tIiwiaWF0IjoxNTE2MjM5MDIyfQ.signature",
    "refreshToken": "at_long_refresh_token_for_account_two",
    "idToken": "eyJlbWFpbCI6InVzZXIyQGdtYWlsLmNvbSJ9.signature"
  }
]
```

## Getting OAuth Tokens

### From CloakBrowser Session (Recommended)

After running the cloakbrowser login script:

```bash
cd /Users/bagusvnt/www/apps/grok-build-cli-re

# Extract tokens from session data
node -e "
const session = require('./grok-autologin/session.json');
const cookies = session.cookies;

// Extract actual JWT tokens from cookies
const accessToken = cookies.find(c => c.name === 'sso')?.value || 'YOUR_ACCESS_TOKEN';
const refreshToken = cookies.find(c => c.name === 'sso-rw')?.value || 'YOUR_REFRESH_TOKEN';
const idToken = cookies.find(c => c.name === '__Secure-*')?.value || 'YOUR_ID_TOKEN';

console.log(JSON.stringify([{
  accessToken,
  refreshToken,
  idToken
}], null, 2));
" > grok-tokens.json
```

### From Browser DevTools (Alternative)

1. Visit https://api.x.ai/ in browser
2. Open DevTools → Network tab
3. Make any API call (e.g., model completion)
4. Copy `Authorization` header value (starts with `Bearer eyJ...`)
5. Decode JWT payload from `id_token` in response to get email

### Manual Collection

If you have OAuth tokens from previous logins:

1. Login at Google → x.ai
2. Capture response from: `https://auth.x.ai/oauth2/token`
3. Extract:
   - `access_token` → accessToken field
   - `refresh_token` → refreshToken field  
   - `id_token` → idToken field

## API Endpoint Details

### POST `/api/oauth/xai/bulk-import`

#### Request Body

```json
{
  "tokens": [
    {
      "accessToken": "string",
      "refreshToken": "string",
      "idToken": "string"
    }
  ]
}
```

#### Success Response

```json
{
  "imported": 2,
  "failed": 0,
  "total": 2,
  "results": [
    {
      "index": 0,
      "email": "user1@gmail.com",
      "connectionId": "conn_xxxxxxxx",
      "status": "success",
      "testStatus": "active",
      "message": "All endpoints validated successfully"
    },
    {
      "index": 1,
      "email": "user2@gmail.com", 
      "connectionId": "conn_yyyyyyyy",
      "status": "success",
      "testStatus": "active",
      "message": "All endpoints validated successfully"
    }
  ]
}
```

#### Error Response

```json
{
  "imported": 1,
  "failed": 1,
  "total": 2,
  "results": [
    {
      "index": 0,
      "email": "valid@example.com",
      "connectionId": "conn_valid",
      "status": "success",
      "testStatus": "active"
    },
    {
      "index": 1,
      "email": null,
      "connectionId": null,
      "status": "failed",
      "error": "Invalid or missing email in id_token",
      "errorDetails": "JWT decode error: Invalid base64 encoding"
    }
  ]
}
```

## Implementation Files

### Backend API

| File | Purpose |
|------|---------|
| `/src/app/api/oauth/xai/bulk-import/route.js` | Main import endpoint handler |
| `/src/lib/oauth/utils/tokenValidator.js` | JWT decoding utilities |

### Frontend UI

| File | Purpose |
|------|---------|
| `/src/shared/components/XaiBulkImportModal.tsx` | Interactive import modal |
| `/src/app/(dashboard)/dashboard/providers/page.js` | Modal integration point |

### Testing & Scripts

| File | Purpose |
|------|---------|
| `/scripts/test-bulk-import.js` | API test script |
| `/scripts/generate-test-tokens.js` | Mock token generator |

## Validation Flow

Each imported account undergoes these steps:

1. **JSON Structure Validation**
   - Verify input is array of objects
   - Check required fields present

2. **JWT Token Decoding**
   - Decode `id_token` to extract email
   - Validate JWT format

3. **Connection Creation**
   - Save tokens to database via `createProviderConnection()`
   - Assign unique connection ID

4. **API Endpoint Testing**
   ```javascript
   // Test 1: Models endpoint (basic auth check)
   fetch("https://api.x.ai/v1/models")
   
   // Test 2: Chat completion (functional check)
   fetch("https://api.x.ai/v1/chat/completions", {
     method: "POST",
     body: JSON.stringify({
       model: "grok-4",
       messages: [{ role: "user", content: "Hello" }]
     })
   })
   ```

5. **Status Update**
   - If all tests pass → mark as `active`
   - If any test fails → mark as `failed` with error details

## Security Considerations

### Token Storage

- Tokens stored in SQLite database
- No encryption at rest (same as existing provider connections)
- Accessible only via authenticated dashboard sessions

### Rate Limiting

- Each import validates tokens sequentially
- ~10 seconds per account (network timeouts)
- Recommend batching < 100 accounts per operation

### Audit Trail

```sql
-- View all import operations
SELECT * FROM providerConnections 
WHERE provider = 'xai' AND authType = 'oauth'
ORDER BY createdAt DESC LIMIT 50;
```

## Troubleshooting

### Common Issues

#### Issue 1: "Missing required fields"

**Cause**: JSON array missing accessToken, refreshToken, or idToken

**Solution**: Verify JSON structure:
```json
[{"accessToken":"...","refreshToken":"...","idToken":"..."}]
```

#### Issue 2: "Invalid or missing email in id_token"

**Cause**: id_token is not a valid JWT or doesn't contain email claim

**Solution**: Use proper id_token from OAuth exchange (not just access_token)

#### Issue 3: "Models endpoint failed"

**Cause**: Token expired or invalid

**Solution**: Refresh token first, then retry import

#### Issue 4: Timeout during import

**Cause**: Network issues or x.ai API slow

**Solution**: Retry with smaller batch size (< 20 accounts)

#### Issue 5: Partial success (some failed, some succeeded)

**Expected behavior** - each account validated independently

**Next Step**: Re-attempt failed accounts after fixing token values

## Usage Examples

### Example 1: Import Single Account

```javascript
// Via fetch API
const response = await fetch("/api/oauth/xai/bulk-import", {
  method: "POST",
  body: JSON.stringify({
    tokens: [{
      accessToken: "your_access_token",
      refreshToken: "your_refresh_token",
      idToken: "your_id_token"
    }]
  })
});

const result = await response.json();
console.log(`Imported ${result.imported} account(s)`);
```

### Example 2: Import Multiple Accounts

```javascript
const tokens = [
  { accessToken: "...", refreshToken: "...", idToken: "..." },
  { accessToken: "...", refreshToken: "...", idToken: "..." },
  { accessToken: "...", refreshToken: "...", idToken: "..." }
];

const response = await fetch("/api/oauth/xai/bulk-import", {
  method: "POST",
  body: JSON.stringify({ tokens })
});

const result = await response.json();
// result.imported = number of successfully created connections
// result.failed = number that failed validation
```

### Example 3: Using with Existing Sessions

Convert cloakbrowser session to tokens:

```javascript
const fs = require("fs");
const session = JSON.parse(fs.readFileSync("session.json"));

const tokenEntry = {
  accessToken: session.cookies.find(c => c.name === "sso")?.value,
  refreshToken: session.cookies.find(c => c.name === "sso-rw")?.value,
  idToken: session.cookies.find(c => c.name.includes("__Secure"))?.value
};

// Now use tokenEntry in bulk import API
```

## Next Steps

To extend this feature:

1. **Scheduled Refresh**: Auto-refresh expiring tokens
2. **Batch Size Limits**: Prevent large batches from timing out
3. **Export Template**: Download example tokens format
4. **Progress Tracking**: WebSocket updates for long imports
5. **Team Support**: Multi-tenant import with project separation
6. **Integration**: One-click import from other OAuth providers

## References

- LobakAI Provider System (`src/lib/oauth/providers/index.js`)
- [xAI API Documentation](https://docs.x.ai/)
- [OAuth 2.0 PKCE Flow](https://datatracker.ietf.org/doc/html/rfc7636)
- [JWT Specification](https://tools.ietf.org/html/rfc7519)

---

**Last Updated**: 2026-08-02  
**Version**: 1.0.0  
**Author**: LobakAI Development Team
