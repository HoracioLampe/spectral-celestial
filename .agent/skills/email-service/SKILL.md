---
name: email-service
description: Email service with HTML templates and DB-backed i18n localization. Use when sending any transactional email (certificate minted, user invitation, password reset).
---

# Email Service

## Architecture

Two services work together:

- **`backend/services/emailService.js`** — Sends emails via Nodemailer (SMTP). Loads HTML templates, renders them with Mustache, injects translations.
- **`backend/services/emailI18nService.js`** — Fetches email translations from the `translations` DB table (module = `'email'`). Caches results for 10 minutes.

## HTML Templates

Templates live in `backend/templates/emails/`:

| File | Trigger |
|------|---------|
| `certificate-minted.html` | After blockchain minteo is confirmed |
| `certificate-invitation.html` | When a cert is issued to a non-registered user |
| `user-invitation.html` | When a new user is invited to the platform |
| `password-reset.html` | Password recovery flow |

Templates use **Mustache** syntax (`{{variable}}`). Available variables depend on the function called (see below).

## Localization (i18n)

Translations are stored in the **`translations` table** in the database:

```sql
SELECT key, value FROM translations
WHERE module = 'email' AND language_code = 'es';
```

Keys use dot notation (e.g. `email.certificateMinted.title`). They are built into a nested object `t` and injected into the template:

```html
<!-- In template -->
<h1>{{t.email.certificateMinted.title}}</h1>
```

The user's `preferred_language` column (on the `users` table) determines which language is used. Supported codes: `es`, `en`, `pt`, `fr`, `de`, `it`.

**Cache:** Translations are cached in memory for 10 minutes per `tenantId:language` key. Call `clearEmailTranslationCache()` after updating translations in DB.

## Available Functions

### `sendCertificateMintedEmail`
Called automatically by `relayerQueueService.js` after a successful blockchain mint.

```js
import { sendCertificateMintedEmail } from './emailService.js';

await sendCertificateMintedEmail({
    email,               // recipient email
    firstName,           // recipient first name
    lastName,            // recipient last name
    tenantName,          // organization name
    certificateTitle,    // certificate title
    documentId,          // certificate UUID
    certificateUrl,      // link to wallet page (FRONTEND_URL/wallet)
    transactionHash,     // blockchain tx hash (links to Polygonscan)
    language,            // user's preferred_language (default: 'es')
    tenantId             // for tenant-specific translations
});
```

### `sendCertificateInvitationEmail`
Sent when a certificate is issued to a user who doesn't have an account yet.

```js
await sendCertificateInvitationEmail({
    email, firstName, lastName,
    inviteToken,         // registration invite token
    tenantName,
    certificateTitle,
    language, tenantId
});
```

### `sendUserInvitationEmail`
Sent when a new user is invited to the platform.

```js
await sendUserInvitationEmail({
    email, firstName,
    inviteToken,
    tenantName,
    language, tenantId
});
```

### `sendPasswordResetEmail`
```js
await sendPasswordResetEmail({
    email, userName,
    resetToken,
    tenantName,
    language, tenantId
});
```

## Environment Variables Required

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=secret
SMTP_FROM=noreply@example.com   # optional, defaults to SMTP_USER
FRONTEND_URL=https://aerocert.up.railway.app
```

## Where Emails Are Triggered

| Event | Location |
|-------|----------|
| Certificate minted on blockchain | `backend/services/relayerQueueService.js` → `processTask()` (after `verified_on_chain`) |
| Certificate invitation | `backend/routes/certificates.js` |
| User invitation | `backend/routes/users.js` |
| Password reset | `backend/routes/auth.js` |

## Adding a New Email Template

1. Create `backend/templates/emails/my-template.html` with Mustache variables
2. Add translation keys to the `translations` table with `module = 'email'`
3. Add a new function in `emailService.js` following the existing pattern
4. Call it from the appropriate route/service

## Important Notes

- **Never hardcode strings** in templates — always use `{{t.email.xxx}}` keys from the DB
- Email failures are **non-fatal** — always wrap in try/catch so they don't break the main flow
- The `bcc` field automatically copies every email to `SMTP_USER` for audit purposes
- `blockchainUrl` in `certificate-minted` template links to `https://polygonscan.com/tx/{{transactionHash}}`
