# Meridian

Meridian is an installable progressive web app that turns a secret into 60-second one-time codes. The secret stays in `localStorage` on this browser. Nothing is uploaded.

The codes match `pyotp` with a 60-second step, SHA-1, and 6 digits:

```python
secret = base64.b32encode(bytes.fromhex(hex_key)).decode()
pyotp.TOTP(secret, interval=60).now()
```

The browser uses [`otpauth`](https://github.com/hectorm/otpauth), an RFC 4226 / RFC 6238 implementation. A hex key is decoded and base32-encoded the same way as the snippet above. You can also paste a base32 secret directly.

Each saved key shows the current code plus the codes for nearby minutes, so one secret produces a run of OTPs. The vault can hold up to 20 keys.

## Live app

<https://b-gor-team.github.io/otp-vault/> is built from this source and served by GitHub Pages. See [docs/github-pages.md](docs/github-pages.md) for the publishing flow, the `/otp-vault/` base path, and the caveats that come with a shared `github.io` origin.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:4731.

Paste a hex key, or use **Use the reference hex key** and compare the live code with the Python one-liner. The reference key is `05a06f6c6f38fc646dbba4f39aeed9719b98d35e`.

## Install

Meridian is a progressive web app.

- Chrome and Edge on desktop or Android: use **Install app** when the browser offers it, or the install icon in the address bar.
- iPhone and iPad: Share, then **Add to Home Screen**.

The production build emits a service worker that precaches the app shell so the installed app opens offline. Codes are still computed on the device. The clock has to be correct.

```bash
npm run build
npm run preview
```

## Tests

```bash
npm test
npm run lint
npm run typecheck
```

Unit tests pin codes that were generated with `pyotp` and check them against a separate HMAC-SHA1 oracle. Component tests cover saving a key, the minute window, reload from storage, copy, reveal, removal, and bad input. GitHub Actions runs lint, typecheck, tests, and the production build on every push and pull request.

## Storage

Keys are stored under `meridian.vault.v1` in this origin's `localStorage`. Clearing site data, or removing a key in the app, deletes the secret. The page does not send the secret anywhere. `localStorage` is not encrypted; anyone who can use this browser profile can open the vault.
