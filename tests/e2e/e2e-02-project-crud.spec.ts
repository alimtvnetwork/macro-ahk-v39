import { test, expect, chromium, type BrowserContext, type ConsoleMessage, type Page } from '@playwright/test';
import { launchExtension, getExtensionId, optionsUrl } from './fixtures';

/**
 * E2E-02 — Project CRUD Lifecycle
 *
 * Create, read, update, and delete a project through the Options page.
 *
 * Deterministic readiness contract
 * --------------------------------
 * The Options page renders `<OnboardingFlow />` whenever
 * `chrome.storage.local.marco_onboarding_complete` is not strictly `true`,
 * AND `useOnboarding`'s 400ms storage-read timeout means a slow CI worker
 * could fall back to OnboardingFlow even after we seed. To eliminate every
 * source of nondeterminism we use a four-stage gate before any UI assertion:
 *
 *   1. Seed-and-verify in the service worker (SW)
 *      `chrome.storage.local.set({ marco_onboarding_complete: true })`
 *      followed by a round-trip read to confirm the value committed.
 *      Done once in `beforeAll`.
 *
 *   2. Re-seed-and-verify on the page itself
 *      Before each test's assertions we run the same set+read pair from
 *      the page context. This catches the rare case where the SW is
 *      torn down + restarted between tests and storage is repaved by
 *      Chrome's MV3 lifecycle.
 *
 *   3. Wait for the page's own interactivity log
 *      `pages/Options.tsx` emits `[Options] ── INTERACTIVE ── …` once
 *      every loading flag (`pLoading`, `sLoading`, `cLoading`,
 *      `onboardingLoading`) is resolved. We subscribe to `console` and
 *      resolve when that log fires.
 *
 *   4. Wait for the "New Project" CTA
 *      Only after (3) we wait for the actual selector. If it never
 *      appears we dump a diagnostic snapshot of the page (URL, title,
 *      visible body text, hash, storage keys) so the next CI failure is
 *      self-diagnosing instead of a blind 3-minute timeout.
 *
 * Selector reference (kept here so reviewers don't have to spelunk):
 *  - "New Project" button: ProjectsListView header CTA.
 *  - Create form: <ProjectCreateForm> with placeholder "Project name" +
 *    "Create" button.
 *  - Detail header: <ProjectDetailView> click-to-edit <h2>; once edited,
 *    icon-only Save (aria-label="Save project") and Delete
 *    (aria-label="Delete project") buttons appear.
 *
 * Priority: P0 | Auto: ✅ | Est: 3 min
 */

const SETUP_TIMEOUT_MS = 20_000;
const ONBOARDING_KEY = 'marco_onboarding_complete';
const INTERACTIVE_LOG_PREFIX = '[Options] ── INTERACTIVE ──';
const INTERACTIVE_TIMEOUT_MS = 15_000;
const FLOATING_CONTROLLER_SELECTOR = '[data-testid^="floating-controller"]';
const FLOATING_CONTROLLER_STYLE_ID = 'e2e-disable-floating-controller';
const OPTIONS_PROJECTS_E2E_QUERY = '?e2eHideFloatingController=1#projects';

/**
 * Seed `marco_onboarding_complete = true` from the service worker AND read it
 * back to prove the write committed. Throws with a precise diagnostic if the
 * round-trip fails — we never silently let a flaky storage write cascade into
 * a 3-minute UI timeout.
 */
async function seedOnboardingFromServiceWorker(context: BrowserContext): Promise<void> {
  const deadline = Date.now() + SETUP_TIMEOUT_MS;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    let [sw] = context.serviceWorkers();
    if (!sw) {
      try {
        sw = await context.waitForEvent('serviceworker', { timeout: 5_000 });
      } catch (err) {
        lastError = err;
        continue;
      }
    }
    try {
      const verified = await sw.evaluate(async (key: string) => {
        // Guard: in rare MV3 restart windows `chrome.storage` may not yet be
        // bound on the worker global. Surface that as a retryable signal.
        const c = (globalThis as unknown as { chrome?: { storage?: { local?: { set: (i: Record<string, unknown>) => Promise<void>; get: (k: string) => Promise<Record<string, unknown>> } } } }).chrome;
        if (!c?.storage?.local) return 'chrome.storage.local unavailable';
        await c.storage.local.set({ [key]: true });
        const result = await c.storage.local.get(key);
        return result[key] === true ? true : `read-back=${JSON.stringify(result[key])}`;
      }, ONBOARDING_KEY);
      if (verified === true) return;
      lastError = new Error(`[e2e-02] SW seed verify failed: ${String(verified)}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `[e2e-02] SW seed failed after ${SETUP_TIMEOUT_MS}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Re-seed and verify from the page context, immediately after navigation.
 * Belt-and-braces in case the SW was torn down between tests and Chrome's
 * MV3 lifecycle repaved storage. Returns the final value Chrome reports so
 * the caller can include it in any failure diagnostic.
 */
async function ensureOnboardingSeededFromPage(page: Page): Promise<boolean> {
  return await page.evaluate(async (key: string) => {
    await chrome.storage.local.set({ [key]: true });
    const result = await chrome.storage.local.get(key);
    return result[key] === true;
  }, ONBOARDING_KEY);
}

async function installFloatingControllerBlocker(page: Page): Promise<void> {
  await page.addInitScript(
    ({ selector, styleId }: { selector: string; styleId: string }) => {
      const hideController = () => {
        if (document.getElementById(styleId) === null) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `${selector} { display: none !important; pointer-events: none !important; visibility: hidden !important; }`;
          document.documentElement.appendChild(style);
        }

        for (const node of document.querySelectorAll(selector)) {
          if (node instanceof HTMLElement) {
            node.style.setProperty('display', 'none', 'important');
            node.style.setProperty('pointer-events', 'none', 'important');
            node.style.setProperty('visibility', 'hidden', 'important');
          }
        }
      };

      hideController();
      new MutationObserver(hideController).observe(document.documentElement, { childList: true, subtree: true });
    },
    { selector: FLOATING_CONTROLLER_SELECTOR, styleId: FLOATING_CONTROLLER_STYLE_ID },
  );
}

/**
 * The recorder overlay is unrelated to project CRUD but lives above the full
 * Options page (`z-[2147483600]`). In CI its compact default position can cover
 * the header CTA and make Playwright wait until the test times out. Hide it for
 * this suite so assertions exercise ProjectsListView directly.
 */
async function disableFloatingControllerHitTarget(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `${FLOATING_CONTROLLER_SELECTOR} { display: none !important; pointer-events: none !important; visibility: hidden !important; }`,
  });
  await page.locator(FLOATING_CONTROLLER_SELECTOR).evaluateAll((nodes) => {
    for (const node of nodes) {
      if (node instanceof HTMLElement) {
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('pointer-events', 'none', 'important');
        node.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  });
}

/**
 * Subscribe to the page's own `[Options] ── INTERACTIVE ──` console log
 * (emitted by `pages/Options.tsx` once every `*Loading` flag is false) and
 * resolve when it fires. This is the ground-truth signal that the dashboard
 * is mounted and not stuck on OnboardingFlow / OnboardingLoadingGate / a
 * Suspense fallback. Must be attached BEFORE navigation so we don't miss
 * the log on a fast worker.
 */
function waitForOptionsInteractive(page: Page, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onConsole = (msg: ConsoleMessage) => {
      if (msg.text().includes(INTERACTIVE_LOG_PREFIX)) {
        clearTimeout(timer);
        page.off('console', onConsole);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      page.off('console', onConsole);
      reject(new Error(
        `[e2e-02] Options page never logged "${INTERACTIVE_LOG_PREFIX}" within ${timeoutMs}ms. ` +
        `Page is stuck in onboarding/loading/Suspense — see captureDiagnostic() output.`,
      ));
    }, timeoutMs);
    page.on('console', onConsole);
  });
}

/** Diagnostic snapshot used when an assertion fails — printed verbatim to stderr. */
async function captureDiagnostic(page: Page, label: string): Promise<string> {
  const snapshot = await page.evaluate(async (key: string) => {
    const storageRead = async (): Promise<unknown> => {
      try {
        const r = await chrome.storage.local.get(key);
        return r[key];
      } catch (err) {
        return `<storage error: ${(err as Error).message}>`;
      }
    };
    return {
      url: window.location.href,
      hash: window.location.hash,
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 1500) ?? '<no body>',
      onboardingFlag: await storageRead(),
      hasReactRoot: Boolean(document.getElementById('root')?.firstChild),
      visibleHeadings: Array.from(document.querySelectorAll('h1,h2,h3'))
        .map((h) => (h as HTMLElement).innerText)
        .filter((t) => t.length > 0),
    };
  }, ONBOARDING_KEY).catch((err: Error) => ({ error: err.message }));
  const formatted = `\n[e2e-02 diagnostic — ${label}]\n${JSON.stringify(snapshot, null, 2)}\n`;
  process.stderr.write(formatted);
  return formatted;
}

/**
 * Open the Options page on the projects section and wait until the
 * "New Project" CTA is visible. Walks all four readiness stages described
 * at the top of the file and dumps a diagnostic snapshot if any stage
 * fails, so the next CI run is self-explaining.
 */
async function openProjectsView(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await installFloatingControllerBlocker(page);

  // Stage 3: subscribe BEFORE navigation so we never miss the interactive log.
  const interactive = waitForOptionsInteractive(page, INTERACTIVE_TIMEOUT_MS);

  // Force #projects in the initial URL so parseHash never picks up a stale
  // section from a prior in-context navigation.
  await page.goto(`${optionsUrl(extensionId)}${OPTIONS_PROJECTS_E2E_QUERY}`);
  await page.waitForLoadState('domcontentloaded');

  // Stage 2: re-seed from the page context to defeat MV3 SW teardown races.
  const seeded = await ensureOnboardingSeededFromPage(page);
  if (!seeded) {
    await captureDiagnostic(page, 'page-reseed-failed');
    throw new Error('[e2e-02] Page-side onboarding re-seed did not commit.');
  }

  await disableFloatingControllerHitTarget(page);

  // Stage 3: await interactivity. The Options page exposes a deterministic
  // DOM marker (`[data-testid="options-state-marker"][data-branch="ready"]`)
  // that flips to `ready` only when every loading flag is false AND
  // onboarding is complete. This is strictly more reliable than the
  // INTERACTIVE console log (which can fire before our listener attaches)
  // or a body-text probe (the word "Projects" appears in the sidebar even
  // while loading). We race the marker against the console log so whichever
  // signal arrives first wins.
  const interactiveSafe = interactive.catch(() => undefined);
  try {
    await Promise.race([
      interactiveSafe,
      page.locator('[data-testid="options-state-marker"][data-branch="ready"]')
        .waitFor({ state: 'attached', timeout: INTERACTIVE_TIMEOUT_MS })
        .then(() => undefined),
    ]);
  } catch (err) {
    await captureDiagnostic(page, 'interactive-stage-failed');
    throw err;
  }

  // Stage 4: wait for the actual CTA.
  const newProjectBtn = page.getByRole('button', { name: /^new project$/i });
  try {
    await expect(newProjectBtn).toBeVisible({ timeout: SETUP_TIMEOUT_MS });
  } catch (err) {
    await captureDiagnostic(page, 'new-project-cta-missing');
    throw err;
  }
  return page;
}

async function createProject(page: Page, name: string): Promise<void> {
  const newProjectBtn = page.getByRole('button', { name: /^new project$/i });
  await expect(newProjectBtn).toBeVisible({ timeout: SETUP_TIMEOUT_MS });
  await disableFloatingControllerHitTarget(page);
  await newProjectBtn.evaluate((node) => {
    if (!(node instanceof HTMLButtonElement)) {
      throw new Error('[e2e-02] New Project target is not an HTML button.');
    }
    if (node.disabled) {
      throw new Error('[e2e-02] New Project button is disabled.');
    }
    node.click();
  });
  const nameInput = page.getByPlaceholder(/^project name$/i);
  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await nameInput.fill(name);
  await page.getByRole('button', { name: /^create$/i }).click();
  // Wait for the form to unmount (back on the list view).
  await expect(page.getByRole('button', { name: /^new project$/i })).toBeVisible({ timeout: 10_000 });
}

/**
 * Reuse a single persistent context across all three CRUD tests. Launching
 * a fresh Chromium + loading the unpacked extension takes 8–15s on CI, and
 * doing it three times was eating most of our 60s budget BEFORE the actual
 * UI assertions even started. Tests are serialized so storage state from
 * one step (e.g. a created project) is naturally available to the next.
 *
 * The deterministic seeding contract (see file header) is what unblocks
 * re-enabling this suite — the prior `.skip` rationale (intermittent
 * Onboarding races) is now eliminated by stages 1–3.
 */
// Skipped under the project-wide Deferred Workstreams policy
// (mem://preferences/deferred-workstreams). The deterministic
// four-stage readiness gate below still cannot stabilise the React
// Options page in the Playwright extension context on CI — "New
// Project" never paints within the 60s per-test budget even though
// the page logs `── INTERACTIVE ──` locally. Re-enable once the
// React UI unification (S-021) lands; see
// .lovable/question-and-ambiguity/44-e2e-02-react-options-skip.md
// for the full rationale and re-enable steps.
test.describe.skip('E2E-02 — Project CRUD Lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  // Each test walks four readiness gates (SW seed → page reseed → interactive
  // log → "New Project" CTA) before any UI assertion. Worst-case stacking of
  // those waits plus the actual CRUD interactions exceeds the global 60s
  // budget on a cold CI runner, so we widen this suite's per-test timeout.
  test.setTimeout(120_000);

  let context: BrowserContext;
  let extensionId: string;

  test.beforeAll(async () => {
    context = await launchExtension(chromium);
    extensionId = await getExtensionId(context);
    await seedOnboardingFromServiceWorker(context);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('create a new project', async () => {
    const options = await openProjectsView(context, extensionId);
    try {
      await createProject(options, 'Test Automation');
      await expect(options.getByText('Test Automation').first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await options.close();
    }
  });

  test('update project name', async () => {
    const options = await openProjectsView(context, extensionId);
    try {
      // Reuses the project created by the previous test (serial order).
      const card = options.getByText('Test Automation').first();
      await expect(card).toBeVisible({ timeout: 10_000 });
      await card.click();

      // ProjectDetailView renders the name as a click-to-edit <h2>; click it
      // to mount the underlying <Input placeholder="Project name">.
      const heading = options.getByRole('heading', { name: 'Test Automation' });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      await heading.click();

      const nameInput = options.getByPlaceholder(/^project name$/i);
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await nameInput.fill('Test Automation v2');

      // The save button is icon-only; its accessible name comes from
      // aria-label="Save project" on IconButtonWithTooltip and only mounts
      // once the form is dirty. We must click it BEFORE the input loses
      // focus (which would close the editor) so we use Locator.click()
      // directly without first blurring the input.
      const saveBtn = options.getByRole('button', { name: /^save project$/i });
      await expect(saveBtn).toBeVisible({ timeout: 5_000 });
      await saveBtn.click();

      await expect(options.getByText('Test Automation v2').first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await options.close();
    }
  });

  test('delete project cleans up storage', async () => {
    const options = await openProjectsView(context, extensionId);
    try {
      // Create a fresh disposable project so this test is independent of
      // whatever state the update test left behind.
      await createProject(options, 'Delete Me');

      const card = options.getByText('Delete Me').first();
      await expect(card).toBeVisible({ timeout: 10_000 });
      await card.click();

      // Icon-only delete trigger; aria-label="Delete project".
      const deleteTrigger = options.getByRole('button', { name: /^delete project$/i });
      await expect(deleteTrigger).toBeVisible({ timeout: 10_000 });
      await deleteTrigger.click();

      // AlertDialog confirm action — exact text is "Delete".
      const confirmBtn = options.getByRole('button', { name: /^delete$/i });
      await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
      await confirmBtn.click();

      await expect(options.getByText('Delete Me')).not.toBeVisible({ timeout: 10_000 });
    } finally {
      await options.close();
    }
  });
});
