import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Vite build config for the Lovable Dashboard standalone script.
 *
 * Compiles TypeScript source → single IIFE JS bundle exposing
 * window.LovableDashboard.
 *
 * Output: standalone-scripts/lovable-dashboard/dist/lovable-dashboard.js
 *
 * Usage: pnpm run build:lovable-dashboard
 *        pnpm run build:lovable-dashboard -- --mode development
 *
 * Dev mode: inline sourcemaps for readable injected stack traces.
 * Prod mode: no sourcemaps, esbuild-minified.
 */
export default defineConfig(({ mode }) => ({
    publicDir: false,
    build: {
        outDir: "standalone-scripts/lovable-dashboard/dist",
        emptyOutDir: false,
        sourcemap: mode === "development" ? "inline" : false,
        minify: mode !== "development" ? "esbuild" : false,
        lib: {
            entry: resolve(__dirname, "standalone-scripts/lovable-dashboard/src/index.ts"),
            name: "LovableDashboard",
            formats: ["iife"],
            fileName: () => "lovable-dashboard.js",
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
            },
        },
    },
    resolve: {
        alias: {
            "@lovable-dashboard": resolve(__dirname, "standalone-scripts/lovable-dashboard/src"),
        },
    },
}));
