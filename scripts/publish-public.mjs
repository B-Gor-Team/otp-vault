#!/usr/bin/env node
// Publish a sanitized snapshot of this repo to the public GitHub Pages repo.
//
// The public repo must not carry private history (this repo's commits mention
// internal hosts) and does not need the office-host deployment stack, so this
// script exports the tracked working tree minus `EXCLUDED`, commits it as a
// single snapshot in a throwaway repo, and pushes it to `public/main`.
//
//   node scripts/publish-public.mjs --dry-run
//   node scripts/publish-public.mjs
//
// Override the remote with PUBLIC_REMOTE=<name> (default: public).

import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Paths that stay private: internal infrastructure and the n8n/Podman plumbing. */
export const EXCLUDED = [
  'deploy/',
  'docs/n8n-webhook-iframe-sandbox-request.md',
  'docs/static-host-deploy.md',
  'plain/',
  'scripts/deploy-static-host.mjs',
  'scripts/push-plain-page.mjs',
  'scripts/static-host.d.mts',
  'scripts/static-host.mjs',
  'src/deploy/',
]

export function isExcluded(file, prefixes = EXCLUDED) {
  return prefixes.some((prefix) =>
    prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix,
  )
}

export function selectFiles(files, prefixes = EXCLUDED) {
  return files.filter((file) => !isExcluded(file, prefixes)).sort()
}

function git(args, options = {}) {
  const out = execFileSync('git', args, { encoding: 'utf8', ...options })
  return typeof out === 'string' ? out.trim() : ''
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const remote = process.env.PUBLIC_REMOTE ?? 'public'
  const repo = fileURLToPath(new URL('..', import.meta.url))

  const tracked = git(['ls-files', '-z'], { cwd: repo }).split('\0').filter(Boolean)
  const files = selectFiles(tracked)
  const dropped = tracked.filter((file) => !files.includes(file)).length

  const sha = git(['rev-parse', '--short', 'HEAD'], { cwd: repo })

  console.log(`Publishing ${files.length} files from ${sha} (${dropped} private files skipped).`)
  if (dryRun) {
    console.log(`Would push to remote '${remote}'. Dry run: nothing changed.`)
    return
  }

  // The snapshot repo has no remotes of its own, so resolve the URL from this repo.
  let remoteUrl
  try {
    remoteUrl = git(['remote', 'get-url', remote], { cwd: repo })
  } catch {
    throw new Error(
      `No '${remote}' remote. Add it with: git remote add ${remote} git@github.com:B-Gor-Team/otp-vault.git`,
    )
  }

  const work = await mkdtemp(path.join(tmpdir(), 'meridian-public-'))
  try {
    for (const file of files) {
      const dest = path.join(work, file)
      await mkdir(path.dirname(dest), { recursive: true })
      await copyFile(path.join(repo, file), dest)
    }

    const identity = [
      '-c',
      `user.name=${git(['config', 'user.name'], { cwd: repo }) || 'Meridian'}`,
      '-c',
      `user.email=${git(['config', 'user.email'], { cwd: repo }) || 'noreply@example.com'}`,
    ]

    git(['init', '--quiet', '-b', 'main'], { cwd: work })
    git(['add', '--all'], { cwd: work })
    git([...identity, 'commit', '--quiet', '-m', `Publish otp-vault@${sha}`], { cwd: work })

    const head = git(['rev-parse', 'HEAD^{tree}'], { cwd: work })
    let sameTree = false
    try {
      git(['ls-remote', '--exit-code', remoteUrl, 'refs/heads/main'], { cwd: work, stdio: 'pipe' })
      git(['fetch', '--quiet', '--depth=1', remoteUrl, 'main'], { cwd: work, stdio: 'pipe' })
      sameTree = git(['rev-parse', 'FETCH_HEAD^{tree}'], { cwd: work }) === head
    } catch {
      // Empty remote or first publish.
    }

    if (sameTree) {
      console.log('Remote already matches this tree. Nothing to push.')
      return
    }

    git(['push', '--force', remoteUrl, 'HEAD:main'], { cwd: work, stdio: 'inherit' })
    console.log(`Pushed ${files.length} files to '${remote}' main as otp-vault@${sha}.`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  await main()
}
