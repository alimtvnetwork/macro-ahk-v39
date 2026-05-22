# Mermaid Design Diagram Spec

Authoring rules for every Mermaid diagram referenced from the `21-app` spec tree.

## Subfolders

| Folder | Contents |
| --- | --- |
| `01-diagram-spec/` | Numbered rule files: syntax, layout, theming, review checklist. |

## Core rules

1. **Direction**: `flowchart TD` unless the diagram is a sequence or class diagram.
2. **Naming**: PascalCase node IDs and labels (`UserClicksRecord`, not `user_clicks_record`).
3. **Theme**: Use the shared `%%{init: {'theme':'dark'}}%%` header. No inline color overrides.
4. **Density**: ≤ 25 nodes per diagram. Split into linked sub-diagrams when exceeded.
5. **Review**: Every diagram PR MUST update the prose spec that owns the flow in the same commit.

See `mem://style/diagram-visual-standards` for the canonical visual contract.
