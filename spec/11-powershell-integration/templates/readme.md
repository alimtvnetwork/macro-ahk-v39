# PowerShell Integration — Templates

Reusable PowerShell fragments and starter files copied into new projects by the runner bootstrap step.

## Files

| File | Purpose |
| --- | --- |
| `powershell.json.tpl` | Minimal config scaffold for a new Go + React project. |
| `run.ps1.tpl` | Thin wrapper that imports the shared runner module. |
| `firewall.json.tpl` | Default dev-time firewall rule set. |

## Rules

- Templates MUST be parameterised with `{{TOKEN}}` placeholders only — no project-specific strings.
- Every template MUST validate against the matching schema in `../schemas/`.
- Do not embed timestamps, version stamps, or auto-update hooks (see `mem://constraints/readme-txt-prohibitions`).
- When adding a template, document the bootstrap command in `../03-integration-guide.md`.
