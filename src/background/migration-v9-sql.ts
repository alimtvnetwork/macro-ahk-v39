/**
 * Marco Extension — Schema Migration v9 SQL
 *
 * Cross-Project Sync Phase 3 — ProjectId contract reconciliation.
 *
 * Why:
 *   `ProjectGroupMember.ProjectId` was originally typed `INTEGER`, but
 *   `StoredProject.id` (chrome.storage.local) is a UUID string. Every row
 *   ever written into the old column was effectively orphaned because no
 *   integer ever resolved to a real `StoredProject.id`.
 *
 * Strategy:
 *   1. Drop the old `ProjectGroupMember` table entirely — pre-v9 rows had
 *      no resolvable foreign key and are not worth preserving.
 *   2. Recreate with `ProjectIdUuid TEXT NOT NULL` referencing
 *      `StoredProject.id` (logical FK; SQLite has no chrome.storage FK).
 *   3. Recreate the lookup index against the new column name.
 *
 * Ambiguity log: `.lovable/question-and-ambiguity/50-project-group-member-id-contract.md`
 * See: spec/21-app/02-features/misc-features/cross-project-sync.md
 */

export const V9_PROJECT_GROUP_MEMBER_REBUILD = `
DROP INDEX IF EXISTS IdxGroupMemberProject;
DROP TABLE IF EXISTS ProjectGroupMember;
CREATE TABLE ProjectGroupMember (
    Id            INTEGER PRIMARY KEY AUTOINCREMENT,
    GroupId       INTEGER NOT NULL REFERENCES ProjectGroup(Id) ON DELETE CASCADE,
    ProjectIdUuid TEXT NOT NULL,
    UNIQUE(GroupId, ProjectIdUuid)
);
CREATE INDEX IdxGroupMemberProject ON ProjectGroupMember(ProjectIdUuid);
`;

export function getV9Statements(): string[] {
    return V9_PROJECT_GROUP_MEMBER_REBUILD
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => s + ";");
}
