# FuelPro Bug Report & Testing Log

## Security and maintenance note

This document is a historical testing log. Any credentials, email addresses, tokens, or other authentication material from earlier test sessions have been intentionally removed. Authentication secrets must never be committed to source control.

## Testing Date

2026-08-01

## Historical Findings

### Bug #1: Legacy Firebase Cloud Connection

**Severity:** Critical (historical)  
**Status:** Resolved by Supabase migration

The original test log reported a Firebase health-check failure in `restApiSync.ts`. The application has since moved its primary data/authentication path to Supabase. The old Firebase remediation steps below are obsolete.

### Bug #2: Users and Stations Count

**Severity:** High (historical)  
**Status:** Resolved

The original report observed zero users and stations during an empty test dataset. The Founder Console now uses the server-side `/api/founder-stats` path to retrieve cross-owner data.

### Bug #3: Audit Log Display

**Severity:** Medium  
**Status:** Requires continued verification

The historical test reported a possible mismatch between the displayed audit count and visible entries. This should be covered by automated Founder Console tests and verified against the canonical `audit_log` table.

## Current Hardening Priorities

1. Keep founder/admin authorization fail-closed and based on server-controlled roles.
2. Never store bearer tokens, passwords, password hashes, or TOTP secrets in application localStorage.
3. Never report failed cloud writes as successful financial transactions.
4. Use a canonical sales ledger for revenue analytics to prevent double counting.
5. Restrict privileged API CORS to the deployed application origin.
6. Refresh regulatory fuel prices frequently enough to respect published validity periods.
7. Keep secrets in server-side environment/secret storage and rotate any credential that was ever committed.
8. Add automated unit, integration, and end-to-end tests for authentication, shifts, sales, reconciliation, sync, reporting, and Founder Console authorization.

## Historical Testing Status

Earlier manual testing covered registration, station creation, point of sale, Founder Dashboard navigation, and local persistence. Those results are retained only as historical context; they are not a substitute for current automated production tests.
