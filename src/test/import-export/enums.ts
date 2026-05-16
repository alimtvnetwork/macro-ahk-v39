/**
 * Enums for the Import/Export E2E suite.
 * Spec: spec/30-import-export/03-test-plan.md §4.
 */

export const ExportArtifactKind = {
  Projects: "Projects",
  Scripts: "Scripts",
  Configs: "Configs",
  Prompts: "Prompts",
  Meta: "Meta",
} as const;
export type ExportArtifactKind = (typeof ExportArtifactKind)[keyof typeof ExportArtifactKind];

export const ScriptOriginKind = {
  InProject: "InProject",
  LibraryReferenced: "LibraryReferenced",
  InlineSynthesized: "InlineSynthesized",
} as const;
export type ScriptOriginKind = (typeof ScriptOriginKind)[keyof typeof ScriptOriginKind];

export const PromptOperationKind = {
  Save: "Save",
  Modify: "Modify",
  Delete: "Delete",
} as const;
export type PromptOperationKind = (typeof PromptOperationKind)[keyof typeof PromptOperationKind];

export const REQUIRED_TABLES: ReadonlyArray<ExportArtifactKind> = [
  ExportArtifactKind.Projects,
  ExportArtifactKind.Scripts,
  ExportArtifactKind.Configs,
  ExportArtifactKind.Prompts,
  ExportArtifactKind.Meta,
];

export const BUNDLE_ENTRY_NAME = "marco-backup.db";
export const SQLITE_MAGIC = "SQLite format 3\0";
