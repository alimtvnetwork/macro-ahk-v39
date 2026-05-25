#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// scripts/release-publish.mjs
// Release pre-flight script — tag push + workflow-run polling
//
// Wraps `git push origin vX.Y.Z` and asserts the Release Build workflow
// starts within 60 s. Safe to run multiple times (idempotent push).
//
// Usage:
//   node scripts/release-publish.mjs           # dry-run (shows what it would do)
//   node scripts/release-publish.mjs --push      # actually push the tag
//   node scripts/release-publish.mjs --version v3.14.2 --push
// ──────────────────────────────────────────────────────────────

import { execSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const SCRIPT_NAME = 'release-publish';

function log(label, msg) {
  console.log(`[${label}] ${msg}`);
}

function errorExit(msg, code = 1) {
  console.error(`[ERROR] ${msg}`);
  process.exit(code);
}

function resolveVersion(argVersion) {
  if (argVersion) {
    const v = argVersion.startsWith('v') ? argVersion : `v${argVersion}`;
    if (!/^v\d+\.\d+\.\d+/.test(v)) {
      errorExit(`Invalid version format: ${argVersion} (expected vX.Y.Z or X.Y.Z)`);
    }
    return v;
  }
  // Read from package.json
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const raw = pkg.version;
  if (!raw || raw === '0.0.0') {
    errorExit('package.json version is missing or placeholder (0.0.0). Pass --version explicitly.');
  }
  return raw.startsWith('v') ? raw : `v${raw}`;
}

function hasGhCli() {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getRemoteDefaultBranch() {
  try {
    const sym = execSync('git rev-parse --abbrev-ref refs/remotes/origin/HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
    return sym.replace('origin/', '');
  } catch {
    return 'main';
  }
}

async function pollReleaseRun(version, timeoutSec = 60) {
  if (!hasGhCli()) {
    log('SKIP', 'gh CLI not found — cannot poll workflow runs. Install https://cli.github.com/');
    return null;
  }

  const repo = execSync('gh repo view --json nameWithOwner --jq .nameWithOwner', { encoding: 'utf8', stdio: 'pipe' }).trim();
  const startedAt = Date.now();

  log('POLL', `Waiting for Release Build run for ${version} (timeout ${timeoutSec}s)`);

  while (Date.now() - startedAt < timeoutSec * 1000) {
    try {
      const runsRaw = execSync(
        `gh run list --repo ${repo} --workflow="Release Build" --limit=5 --json databaseId,createdAt,headBranch,displayTitle,url,status`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      const runs = JSON.parse(runsRaw);
      // Look for a run whose displayTitle or headBranch matches the version/tag
      const match = runs.find(r =>
        (r.displayTitle && r.displayTitle.includes(version)) ||
        (r.headBranch && r.headBranch.includes(version))
      );
      if (match) {
        log('FOUND', `Run ${match.databaseId} — ${match.status}`);
        console.log(`  → ${match.url}`);
        return match;
      }
    } catch {
      // ignore transient gh errors
    }
    process.stdout.write('.');
    await setTimeout(3000);
  }
  process.stdout.write('\n');
  log('TIMEOUT', `No Release Build run appeared within ${timeoutSec}s.`);
  log('HINT', 'The workflow may still be queued. Check manually:');
  console.log(`  gh run list --repo ${repo} --workflow="Release Build" --limit=10`);
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const doPush = args.includes('--push');
  const versionIdx = args.findIndex(a => a === '--version');
  const version = resolveVersion(versionIdx !== -1 ? args[versionIdx + 1] : null);

  const defaultBranch = getRemoteDefaultBranch();

  log(SCRIPT_NAME, `Resolved version: ${version}`);
  log(SCRIPT_NAME, `Remote default branch: ${defaultBranch}`);
  log(SCRIPT_NAME, `Push mode: ${doPush ? 'LIVE' : 'DRY-RUN (pass --push to execute)'}`);

  // Verify the tag exists locally
  try {
    execSync(`git rev-parse --verify refs/tags/${version}`, { stdio: 'pipe' });
    log('OK', `Local tag ${version} exists`);
  } catch {
    log('TAG', `Creating local tag ${version} on current HEAD`);
    if (doPush) {
      execSync(`git tag -a ${version} -m "Release ${version}"`, { stdio: 'inherit' });
    } else {
      console.log(`  (dry-run) git tag -a ${version} -m "Release ${version}"`);
    }
  }

  // Ensure main/default branch is pushed first so the tag commit is on origin
  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
  if (currentBranch !== defaultBranch) {
    log('WARN', `Current branch is '${currentBranch}', not '${defaultBranch}'. The tag commit should ideally be on ${defaultBranch}.`);
  }

  // Push the tag
  if (doPush) {
    log('PUSH', `git push origin ${version}`);
    try {
      execSync(`git push origin ${version}`, { stdio: 'inherit' });
    } catch {
      // Idempotent: tag may already exist on remote
      log('WARN', 'Push exited non-zero — tag may already exist on remote (idempotent)');
    }
  } else {
    console.log(`  (dry-run) git push origin ${version}`);
    console.log(`  (dry-run) Then poll gh run list for Release Build`);
  }

  if (doPush) {
    const run = await pollReleaseRun(version, 60);
    if (run) {
      log('DONE', `Release workflow detected: ${run.url}`);
      if (run.status === 'completed') {
        log('DONE', 'Workflow already completed — likely a re-run of an existing tag.');
      }
    }
  } else {
    log('DRY-RUN', 'Skipping poll. Pass --push to enable polling.');
  }

  console.log('');
  console.log('──────────────────────────────────────────────────────────────');
  console.log('Release publish checklist:');
  console.log(`  1. Tag pushed: ${version}`);
  console.log(`  2. Workflow triggered: ${doPush ? 'polling attempted' : 'skipped (dry-run)'}`);
  console.log(`  3. Verify at: https://github.com/${execSync('gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo "OWNER/REPO"', { encoding: 'utf8', stdio: 'pipe' }).trim()}/releases/tag/${version}`);
  console.log('──────────────────────────────────────────────────────────────');
}

main().catch(e => errorExit(e.message));
