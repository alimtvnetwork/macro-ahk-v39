/**
 * Lovable User Add — Project Instruction Manifest
 *
 * Phase P11 scaffold: declares dependency on `lovable-common` (XPaths +
 * LovableApiClient) and registers the empty `LovableUserAdd` entry
 * class. Migrations (P12), CSV (P13), UI (P14) and flow (P15–P17) plug
 * in via subsequent phases without changing this manifest's shape.
 *
 * R12 invariant: Step B (Owner promotion) MUST call the shared
 * `LovableApiClient.promoteToOwner(...)` — same call site Owner Switch
 * uses. No separate PUT implementation in this project.
 *
 * All keys PascalCase per `mem://standards/pascalcase-json-keys`.
 */

import type { ProjectInstruction } from "../../types/instruction/project-instruction";
import type { EmptySettings } from "../../types/instruction/seed/empty-settings";

const instruction: ProjectInstruction<EmptySettings> = {
    SchemaVersion: "1.0",
    Name: "lovable-user-add",
    DisplayName: "Lovable User Add",
    Version: "3.12.0",
    Description: "Bulk-add Lovable workspace members from a CSV; promotes Owner rows via shared promoteToOwner.",
    World: "MAIN",
    IsGlobal: false,
    Dependencies: ["lovable-common"],
    LoadOrder: 61,
    Seed: {
        Id: "default-lovable-user-add",
        SeedOnInstall: true,
        IsRemovable: false,
        AutoInject: true,
        RunAt: "document_idle",
        TargetUrls: [{ Pattern: "https://lovable.dev/*", MatchType: "glob" }],
        Cookies: [],
        Settings: {},
    },
    Assets: {
        Css: [],
        Configs: [],
        Scripts: [
            { File: "lovable-user-add.js", Order: 1, IsIife: true },
        ],
        Templates: [],
        Prompts: [],
    },
};

export default instruction;
