import "@testing-library/jest-dom";
import { vi } from "vitest";
import { resolve } from "node:path";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

/**
 * sql.js in Vitest (jsdom + node) detects ENVIRONMENT_IS_NODE and loads the
 * wasm via fs.readFileSync(locateFile(...)). Production code passes a URL
 * (e.g. https://sql.js.org/dist/sql-wasm.wasm), which fs can't open.
 *
 * Globally rewrite locateFile to the real on-disk wasm so every test that
 * pulls in sql.js (directly or transitively via @/lib/sqlite-bundle) works
 * without needing a per-file shim.
 *
 * Spec: spec/30-import-export/03-test-plan.md §1
 */
const WASM_DISK_PATH = resolve(
  process.cwd(),
  "node_modules/sql.js/dist/sql-wasm.wasm",
);

type InitSqlJsConfig = { locateFile?: (file: string) => string } | undefined;
type SqlJsModule = { default: (config?: InitSqlJsConfig) => Promise<unknown> };

vi.mock("sql.js", async () => {
  const actual = (await vi.importActual<SqlJsModule>("sql.js"));
  const wrapped = (config: InitSqlJsConfig = {}) =>
    actual.default({ ...(config ?? {}), locateFile: () => WASM_DISK_PATH });
  return { ...actual, default: wrapped };
});
