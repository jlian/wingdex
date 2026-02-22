# Auth UX Spec

> Branch: `passkey-ux` · PR: #158

## Overview

WingDex uses a **demo-first** auth model. Visitors land in the app immediately
as anonymous users and can browse, load demo data, and explore the full UI
without signing up. When they attempt a write action (e.g. uploading photos),
an auth gate modal prompts them to create an account.

Authentication methods:
- **Passkeys** — primary, zero-password signup via WebAuthn
- **Social providers** — GitHub (active), Apple (credentials pending)
- **Anonymous sessions** — auto-created on first visit, promoted on signup

## Architecture

### Session bootstrap (App.tsx)

1. App mounts, `authClient.useSession()` checks for existing session
2. No session: auto-create anonymous session via `signIn.anonymous()`
3. Anonymous session renders full `AppContent` (no login wall)
4. Dev-only fallback: if anonymous bootstrap fails (no Wrangler), use
   synthetic `getFallbackUser()` so Vite-only mode still works

### Auth gate (use-auth-gate.tsx)

`useAuthGate()` hook returns:
- `requireAuth(callback)` — if anonymous, opens signup modal; if authenticated,
  runs callback immediately
- `openSignIn()` — opens modal in login mode (for header "Sign in" link)
- `authGateModal` — JSX element rendered once in the component tree

Gated actions: Add Photos, eBird CSV import.
Ungated: browsing, demo data, export, appearance settings.

### Auth gate modal

Reddit-style dual-mode dialog:

```
+----------------------------------+
| Sign up                          |
| By continuing you accept our     |
| Terms of Use and Privacy Policy. |
|                                  |
| [Continue with GitHub]           |
| [Continue with Apple]            |
|                                  |
| -- or --                         |
|                                  |
| [  Email (optional)           ]  |
| [Sign up with a Passkey]         |
|                                  |
| Already have a WingDex? Log in   |
|                                  |
| +- Demo data ------------ [on] + |
| | Preview with sample sightings | |
| +-------------------------------+ |
+----------------------------------+
```

**Sign-up flow:**
1. User optionally enters email
2. Clicks "Sign up with a Passkey"
3. If email provided and account exists, route to `signIn.passkey()`
4. Otherwise, `addPasskey({ name: email || birdName })` via WebAuthn create
5. `POST /api/auth/finalize-passkey` promotes anonymous user to real

**Log-in flow:**
1. User clicks "Log in with a Passkey"
2. `signIn.passkey()` via WebAuthn get, OS shows existing passkeys
3. Session verified as non-anonymous before completing

**Social flow:**
1. User clicks "Continue with GitHub/Apple"
2. OAuth redirect, callback, session established

### Passkey keychain labels

The `name` parameter passed to `addPasskey()` becomes the keychain label in
iOS Settings > Passwords. If user provides email, the label is their email;
otherwise, an auto-generated bird name (e.g. "Scarlet Tanager"). This is
cosmetic and cannot be updated programmatically after creation.

## Settings: Account management

### Account card (authenticated users only)

- Emoji avatar picker (8 options, stored as `user.image`)
- Editable nickname (`user.name`)
- Email section: shows current email, or "Add email for account recovery"
  with input + save button if placeholder (`@localhost`)
- Log out button

### Passkey card

- Lists all passkeys: name + creation date
- Delete button per passkey (disabled if only one remains)
- "Add passkey for this device" button
- Error handling for `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` and
  `ERROR_CEREMONY_ABORTED`

## Account linking

Config in `functions/lib/auth.ts`:
```ts
accountLinking: {
  enabled: true,
  trustedProviders: ['github', 'apple'],
  allowDifferentEmails: true,
}
```

| Scenario | Result |
|----------|--------|
| Social A (email X) then Social B (email X) | Auto-merge (both trusted) |
| Social (email X) then add passkey | Passkey added to same user |
| Passkey (anon email) then Social | Separate accounts (no match key) |
| Passkey (verified email X) then Social (email X) | Auto-merge (email matches) |
| Passkey (unverified email X) then Social (email X) | **UNSAFE** — see below |

### Pre-account hijacking vulnerability

Better Auth's auto-link (`link-account.mjs` line 22) checks whether the
*incoming* provider is trusted, but does **not** check whether the *existing*
user's email is verified. This means:

1. Attacker creates passkey account claiming `victim@gmail.com` (unverified)
2. Victim signs in with GitHub (same email, trusted provider)
3. Auto-link fires: victim's GitHub linked to attacker's account
4. Attacker's passkey now accesses victim's data

**Mitigation:** Never store unverified email on `user.email`. The
`anon_xxx@localhost` placeholder stays until email is OTP-verified. This
makes social-to-social auto-merge safe (both emails verified by their
providers) and prevents passkey email squatting.

See [EMAIL_VERIFICATION.md](EMAIL_VERIFICATION.md) for the verification spec.

## Server endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/finalize-passkey` | Session | Promote anon to real user (name only, no email) |
| GET | `/api/auth/providers` | None | List configured social providers |
| POST | `/api/auth/send-email-otp` | Session | Send verification OTP (planned) |
| POST | `/api/auth/verify-email-otp` | Session | Verify OTP and set email (planned) |

## Implementation status

| Feature | Status |
|---------|--------|
| Demo-first anonymous bootstrap | Done |
| Auth gate hook + modal | Done |
| Passkey signup with bird names | Done |
| Social sign-in (GitHub) | Done |
| Settings: account card, passkey management | Done |
| Email collection at signup | Done (UI only) |
| Email verification via OTP | Spec'd, not implemented |
| Finalize-passkey: stop setting unverified email | Pending |
| Remove check-email endpoint | Pending (account enumeration risk) |
| Apple Sign In | Credentials pending |
