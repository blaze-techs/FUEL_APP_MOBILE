# Security Policy

## Reporting a Vulnerability

Do NOT open a public issue for security problems. Use the private security advisory at https://github.com/blazebanditske/FUEL_APP_MOBILE/security/advisories.

Include: a description of the issue, affected files, and steps to reproduce if known.

## Credential Hygiene

- Never commit live API keys, tokens, passwords, or private keys. Use placeholders or environment variables.
- A Google Gemini API key that was hardcoded in the source was removed from every branch tip during migration. It was replaced with AIzaSy_REPLACE_WITH_GOOGLE_API_KEY.
- Restore AI features by injecting your own Google API key via an environment variable and rebuilding. Do not hardcode it.
- Revoke or rotate any credential that has previously appeared in git history or in chats.

## If You Accidentally Commit a Secret

1. Revoke the secret at its source immediately.
2. Remove it from current files with a new commit.
3. Keep this repository private until the exposure is cleaned from history or the credential is revoked.
4. Contact GitHub Support ifthe secret was a GitHub token.
