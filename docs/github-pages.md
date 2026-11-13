# GitHub Pages deployment

The PWA is published from the public repo **`B-Gor-Team/otp-vault`** at
<https://b-gor-team.github.io/otp-vault/>.

| | |
| --- | --- |
| Public repo | `B-Gor-Team/otp-vault` (public) |
| Private source | `pxxwdev/otp-vault` (this repo) |
| URL | <https://b-gor-team.github.io/otp-vault/> |
| Base path | `/otp-vault/` |
| Build | `.github/workflows/pages.yml`, `MERIDIAN_BASE=/otp-vault/ npm run build` |
| Artifact | `dist/` uploaded with `actions/upload-pages-artifact`, deployed by `actions/deploy-pages` |
| Pages source | GitHub Actions (`build_type: workflow`) |

## Why a separate public repo

GitHub Pages does not serve private repositories on a Free-plan organization, and this
repo's history mentions internal hostnames and the office-host deployment. So the public
repo is a **fresh, single-commit snapshot** of the app with the internal infra removed:
`deploy/`, `docs/static-host-deploy.md`, `docs/n8n-webhook-iframe-sandbox-request.md`,
`plain/`, `scripts/deploy-static-host.mjs`, `scripts/push-plain-page.mjs`,
`scripts/static-host.{mjs,d.mts}`, `src/deploy/`.

## Publishing an update

```bash
git -C . remote add public git@github.com:B-Gor-Team/otp-vault.git   # once
node scripts/publish-public.mjs --dry-run
node scripts/publish-public.mjs
```

The script copies the tracked working tree minus the private paths above into a
throwaway repo, commits it as `Publish otp-vault@<sha>`, and force-pushes to
`public/main`. It skips the push when the remote tree already matches. The push triggers
`pages.yml`, which rebuilds with the `/otp-vault/` base and republishes.

`pxxwdev/otp-vault` stays the source of truth and keeps its own history; the public repo
never receives it.

## How the sub-path works

The app is built for the origin root by default, so four things are base-aware:

- `vite.config.ts` — `base` comes from `MERIDIAN_BASE` (default `/`).
- `public/manifest.webmanifest` — `id`, `start_url`, `scope` and the icons are relative
  (`"./"`), so they resolve against the manifest URL at `/` and at `/otp-vault/` alike.
- `src/pwa/register.ts` — registers `${BASE_URL}sw.js`.
- `src/pwa/sw.js` + `scripts/build-sw.mjs` — Workbox is loaded from `./workbox-v…/`, and
  the offline shell is looked up with `new URL('index.html', self.registration.scope)`.

The office-host build (default base `/`) is unchanged.

## Verify a deployment

```bash
curl -sI https://b-gor-team.github.io/otp-vault/ | head -1
curl -s  https://b-gor-team.github.io/otp-vault/ | grep -o '/otp-vault/assets/[^"]*'
curl -sI https://b-gor-team.github.io/otp-vault/manifest.webmanifest | grep -i content-type
curl -s  https://b-gor-team.github.io/otp-vault/sw.js | grep -o "importScripts([^)]*)"
```

Then in the browser: DevTools → Application → Manifest and Service Workers. The worker
should be *activated and running*, with the shell in Cache Storage. Installed app opens
offline; codes are still computed on the device.

## Caveats

- **Shared origin.** Every project site in the organization lives under
  `b-gor-team.github.io`, and `localStorage` is per origin, not per path. A sibling Pages
  project could read `meridian.vault.v1`. Moving to a custom domain isolates the vault;
  do that before storing high-value keys here.
- **No migration path.** Keys live in `localStorage` for one origin and the app has no
  export/import, so keys saved on another origin (the office host) must be re-added.
- **Update latency.** GitHub Pages caches `sw.js` for up to ~10 minutes. The worker calls
  `skipWaiting()` and `clientsClaim()`, so the new shell applies on the next visit after
  that window.
- **Manifest MIME.** Pages must serve `manifest.webmanifest` as a JSON MIME type. If it
  ever comes back as `application/octet-stream`, reference the manifest through a
  `.json` copy instead.

## Rollback

Revert the public snapshot to an earlier commit and push it, or re-run the last good
`pages.yml` run:

```bash
gh api -X POST repos/B-Gor-Team/otp-vault/actions/runs/<run-id>/rerun --jq '.status'
node scripts/publish-public.mjs   # after reverting the snapshot commit
```
