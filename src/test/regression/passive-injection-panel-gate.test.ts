/**
 * Regression tests — passive injection must not open MacroLoop panel.
 *
 * Auto-attach should register page globals/responder only. The visible
 * controller panel is reserved for explicit user launches (Run script,
 * shortcut, or context menu).
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const INJECTION_WRAPPER_FILE = "src/background/handlers/injection-wrapper.ts";
const AUTO_INJECTOR_FILE = "src/background/auto-injector.ts";
const STARTUP_FILE = "standalone-scripts/macro-controller/src/startup.ts";
const IDEMPOTENT_FILE = "standalone-scripts/macro-controller/src/startup-idempotent-check.ts";

function readFile(relPath: string): string {
    return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
}

describe("passive injection panel gate", () => {
    it("auto-inject marks wrapped scripts as passive", () => {
        const content = readFile(AUTO_INJECTOR_FILE);
        expect(content).toContain("AUTO_INJECT_LAUNCH_SOURCE");
        expect(content).toContain("\"passive\"");
    });

    it("wrapper writes launch source before user code executes", () => {
        const content = readFile(INJECTION_WRAPPER_FILE);
        expect(content).toContain("window.__MARCO_LAUNCH_SOURCE__");
        expect(content).toContain("__mManualAfterPassive");
    });

    it("startup exits before visible UI for passive attach", () => {
        const content = readFile(STARTUP_FILE);
        expect(content).toContain("bootstrapPassiveAttach(deps)");
        expect(content).toContain("Passive attach — no visible UI");
    });

    it("manual run after passive attach upgrades to full panel bootstrap", () => {
        const content = readFile(IDEMPOTENT_FILE);
        expect(content).toContain("Manual Run script after passive attach");
        expect(content).toContain("marker.getAttribute('data-launch-source') === 'passive'");
    });
});