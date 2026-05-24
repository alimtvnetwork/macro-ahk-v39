/**
 * Lovable Common — Project Instruction Manifest
 *
 * Shared utility module consumed at runtime by:
 *   - lovable-owner-switch
 *   - lovable-user-add
 *
 * Phase: P1 — exposes XPathKeyCode + DefaultXPaths + DefaultDelaysMs only.
 * Future phases add LovableApiClient (P2/P3) and the shared XPath editor (P18).
 *
 * All keys PascalCase per `mem://standards/pascalcase-json-keys`.
 */

import type { ProjectInstruction } from "../../types/instruction/project-instruction";
import type { EmptySettings } from "../../types/instruction/seed/empty-settings";

const instruction: ProjectInstruction<EmptySettings> = {
    SchemaVersion: "1.0",
    Name: "lovable-common",
    DisplayName: "Lovable Common (XPath + API)",
    Version: "3.9.0",
    Description: "Shared XPaths, default delays, and (future) LovableApiClient consumed by Lovable Owner Switch and Lovable User Add.",
    World: "MAIN",
    IsGlobal: false,
    Dependencies: [],
    LoadOrder: 5,
    Seed: {
        Id: "default-lovable-common",
        SeedOnInstall: true,
        IsRemovable: false,
        AutoInject: false,
        RunAt: "document_idle",
        TargetUrls: [],
        Cookies: [],
        Settings: {},
    },
    Assets: {
        Css: [],
        Configs: [],
        Scripts: [
            { File: "lovable-common.js", Order: 1, IsIife: true },
        ],
        Templates: [],
        Prompts: [],
    },
};

export default instruction;
