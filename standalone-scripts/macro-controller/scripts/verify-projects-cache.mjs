#!/usr/bin/env bun
/**
 * Step 14 — End-to-end SQLite verification for the Projects list cache.
 *
 * Runs in Bun so it can import the TS module directly. Mocks
 * `window.marco.kv` with an in-memory Map that mirrors the SQLite-backed
 * bridge contract: get(key) → string|null, set(key,val) → void,
 * delete(key) → void.
 *
 * Exercises:
 *   1. write → read round trip (hit)
 *   2. read of unknown workspace (miss)
 *   3. TTL expiration (manual ExpiresAt rewind)
 *   4. clear → read (miss)
 *   5. malformed JSON in the row → null
 *   6. row with wrong shape → null
 *   7. KV unavailable → graceful null/no-throw
 *
 * Exit code: 0 = all green, 1 = any failure.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

// --- Install global mocks BEFORE importing the SUT.
const store = new Map();
const kvCalls = { get: 0, set: 0, delete: 0 };

const fakeKv = {
    async get(key) { kvCalls.get++; return store.has(key) ? store.get(key) : null; },
    async set(key, val) { kvCalls.set++; store.set(key, val); },
    async delete(key) { kvCalls.delete++; store.delete(key); },
};

globalThis.window = {
    marco: { kv: fakeKv },
    location: { pathname: '/verify', href: 'http://verify/', hostname: 'verify' },
};
// Stub `document` so the shared `log()` (which fans out to the activity-log
// DOM updater) is a no-op in this Node/Bun verification environment.
globalThis.document = { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }) };

// Stub settings-store to avoid the chrome.storage dependency chain.
const SETTINGS_PATH = resolve(srcRoot, 'settings-store.ts');
// allow-swallow: settings-store probe is best-effort; absence is a valid env (Node verification script, no chrome.storage)
await import(SETTINGS_PATH).catch(() => null);

// Now import the SUT.
const cacheMod = await import(resolve(srcRoot, 'projects-cache.ts'));
const { readProjectListCache, writeProjectListCache, clearProjectListCache } = cacheMod;

let failures = 0;
function check(name, cond, detail) {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.log(`  ✗ ${name}` + (detail ? ` — ${detail}` : ''));
    }
}

const sampleProjects = [
    { Id: 'p1', Name: 'Alpha', GithubRepo: 'org/alpha', GithubBranch: 'main', LastMessageAt: '2026-05-01T00:00:00Z' },
    { Id: 'p2', Name: 'Beta',  GithubRepo: '',          GithubBranch: '',     LastMessageAt: '' },
];

console.log('\n[1] write → read round trip');
writeProjectListCache('ws-A', sampleProjects, 60_000);
await new Promise(r => setTimeout(r, 20)); // let the fire-and-forget settle
const r1 = await readProjectListCache('ws-A');
check('row returned', r1 !== null);
check('WorkspaceId preserved', r1?.WorkspaceId === 'ws-A');
check('Projects.length === 2', r1?.Projects?.length === 2);
check('Project[0].Name === "Alpha"', r1?.Projects?.[0]?.Name === 'Alpha');
check('ExpiresAt is future', typeof r1?.ExpiresAt === 'number' && r1.ExpiresAt > Date.now());
check('FetchedAt is ISO', typeof r1?.FetchedAt === 'string' && !Number.isNaN(Date.parse(r1?.FetchedAt ?? '')));

console.log('\n[2] miss on unknown workspace');
const r2 = await readProjectListCache('ws-UNKNOWN');
check('returns null', r2 === null);

console.log('\n[3] TTL expiration');
const rawA = store.get('MacroProjectListCache:ws-A');
const parsedA = JSON.parse(rawA);
parsedA.ExpiresAt = Date.now() - 1000;
store.set('MacroProjectListCache:ws-A', JSON.stringify(parsedA));
const r3 = await readProjectListCache('ws-A');
check('expired row returns null', r3 === null);

console.log('\n[4] clear → read miss');
writeProjectListCache('ws-B', sampleProjects, 60_000);
await new Promise(r => setTimeout(r, 20));
check('row present before clear', store.has('MacroProjectListCache:ws-B'));
clearProjectListCache('ws-B');
await new Promise(r => setTimeout(r, 20));
check('row gone after clear', !store.has('MacroProjectListCache:ws-B'));
const r4 = await readProjectListCache('ws-B');
check('read after clear returns null', r4 === null);

console.log('\n[5] malformed JSON');
store.set('MacroProjectListCache:ws-C', '{not json');
const r5 = await readProjectListCache('ws-C');
check('returns null without throwing', r5 === null);

console.log('\n[6] wrong-shape row');
store.set('MacroProjectListCache:ws-D', JSON.stringify({ WorkspaceId: 'ws-D', Projects: 'oops' }));
const r6 = await readProjectListCache('ws-D');
check('returns null on bad shape', r6 === null);

console.log('\n[7] KV unavailable');
globalThis.window.marco = undefined;
const r7 = await readProjectListCache('ws-A');
check('read returns null when KV missing', r7 === null);
let threw = false;
try { writeProjectListCache('ws-E', sampleProjects); } catch { threw = true; }
check('write does not throw when KV missing', !threw);
let threw2 = false;
try { clearProjectListCache('ws-E'); } catch { threw2 = true; }
check('clear does not throw when KV missing', !threw2);

console.log(`\nKV calls — get:${kvCalls.get} set:${kvCalls.set} delete:${kvCalls.delete}`);
console.log(failures === 0 ? '\nALL CHECKS PASSED ✅' : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
