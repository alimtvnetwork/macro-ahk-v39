# 21-app · Design Diagrams

Architecture and flow diagrams for the Marco Chrome extension. Diagrams are authored as text (Mermaid) so they version-control cleanly and render in GitHub, the docs viewer, and Lovable previews.

## Subfolders

| Folder | Contents |
| --- | --- |
| `mermaid-design-diagram-spec/` | Authoring rules for Mermaid diagrams used across the app spec. |

## Authoring rules

- **Format**: Mermaid only. No PNG/SVG checked in unless it is the rendered output of a tracked `.mmd` source.
- **Style**: PascalCase node labels, top-down layout, dark XMind aesthetic — see `mem://style/diagram-visual-standards`.
- **Scope**: One diagram per concern. Cross-link rather than embed multiple unrelated flows in one file.
- **Source of truth**: When a diagram conflicts with prose in another spec, the prose wins and the diagram MUST be updated.
