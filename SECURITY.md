# Security Policy

## Reporting a Vulnerability

Do NOT open a public issue for security problems. Use the private security advisory at https://github.com/blazebanditske/FUEL_APP_MOBILE/security/advisories.

Include a description of the issue, affected files, and steps to reproduce if known.

## Credential Hygiene

- Never commit live API keys, tokens, passwords, Firebase service-account files, or private keys. Use placeholders, environment variables, and .env.example.
- Google Gemini and Firebase Web API keys that were previously hardcoded were removed during migration and replaced with AIzaSy_REPLACE_WITH_GOOGLE_API_KEY and AIzaSy_REPLACE_WITH_FIREBASE_WEB_API_KEY.
- Restore services by injecting your own keys via environment variables and rebuilding. Do not hardcode live keys.
- Revoke or rotate any credential that has previously appeared in git history or chats.
- Only text/plain, text/markdown, code, and config files belong in the repo. Build artifacts (*.exe, *.apk, *.zip, dist/, release/) are ignored and should be distributed as GitHub Release assets, not committed.

## If You Accidentally Commit a Secret

1. Revoke the secret at its source immediately.
2. Remove it from current files with a new commit.
3. Keep this repository private until the exposure is cleaned from history or the credential is revoked.
4. Contact GitHub Support ifthe secret was a GitHub token.
