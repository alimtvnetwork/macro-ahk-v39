# PowerShell Integration — Examples

Working `powershell.json` configurations for reference projects. Each example demonstrates a distinct deployment shape consumed by the runner defined in `../00-overview.md`.

## Layout

| File | Project shape | Notes |
| --- | --- | --- |
| `wp-plugin-publish.json` | Go API + Vite SPA, single host | Baseline pnpm PnP config. |
| `spec-management.json` | Go API + React admin, dual port | Demonstrates `frontendPort` override. |
| `multi-site.json` | Multi-tenant deployment | Pairs with `../25-multi-site-deployment.md`. |

## Contributing

1. Drop a real-world config (with secrets scrubbed) into this folder.
2. Validate against `../schemas/powershell.schema.json`.
3. Add a row above describing the shape it exercises.

Examples are documentation, not source of truth — the canonical schema lives in `../01-configuration-schema.md`.
