# PowerShell Integration — Schemas

JSON Schema (draft-07) documents that validate runner inputs.

## Files

| File | Validates | Spec reference |
| --- | --- | --- |
| `powershell.schema.json` | Project-level `powershell.json` | `../01-configuration-schema.md` |
| `firewall-rules.schema.json` | Firewall rule manifests | `../05-firewall-rules.md` |
| `multi-site.schema.json` | Multi-site deployment manifests | `../25-multi-site-deployment.md` |

## Authoring rules

- `$schema` MUST be `http://json-schema.org/draft-07/schema#`.
- All required properties listed in the prose spec MUST appear in `required`.
- No defaults that diverge from the prose spec — update the prose first, then the schema.
- Treat schemas as the executable contract; CI runs `ajv validate` against every example in `../examples/`.
