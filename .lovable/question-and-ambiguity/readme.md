# Question & Ambiguity Log

Active under No-Questions Mode (opened 2026-04-26). Each entry records an ambiguity, options with pros/cons, and the chosen path.

- [20 — Member-management endpoints (invite / remove / promote)](./20-member-management-endpoints.md) — Recommend Option A: assume conventional REST `/workspaces/{wsId}/memberships[/{userId}]` shape and patch on first 404.
- [50 — ProjectGroupMember.ProjectId contract (number vs UUID)](./50-project-group-member-id-contract.md) — Recommend Option C: fix the useEffect bug now, defer drag-to-assign until logs.db migration v8 normalizes ProjectId to UUID.
- [51 — Bulk Remix Next: target scope](./51-bulk-remix-next-scope.md) — Recommend Option A: iterate checked workspace rows (rename feature to "Bulk Remix Next across checked workspaces"); deferred this loop.
- [52 — Projects modal: HTTP 405 on `GET /projects/{projectId}`](./52-projects-get-405.md) — Recommend Option A: drop `projects.get`, enrich CSV rows from `projects.list` response (eliminates 405, removes N extra HTTP calls per export).
- [53 — HEFF: script-resolver candidate fallback on HTTP failure](./53-heff-script-resolver-network-vs-http.md) — Recommend Option C: network errors → try next candidate; HTTP 4xx/5xx → stop the resolver (HEFF-compliant fallback).
