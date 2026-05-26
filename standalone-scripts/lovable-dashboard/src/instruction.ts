/**
 * Lovable Dashboard — Project Instruction Manifest
 *
 * Auto-injects ONLY on the exact Lovable dashboard URL. Hosts the
 * home-screen experience (search bar, nav controls, credit panel,
 * workspace dictionary, focus-selected, macro-sync). Extracted from
 * macro-controller bundled home-screen content script into its own
 * standalone project per the 26-step extraction plan.
 *
 * All keys PascalCase per `mem://standards/pascalcase-json-keys`.
 */

import type { ProjectInstruction } from "../../types/instruction/project-instruction";
import type { EmptySettings } from "../../types/instruction/seed/empty-settings";

const instruction: ProjectInstruction<EmptySettings> = {
    SchemaVersion: "1.0",
    Name: "lovable-dashboard",
    DisplayName: "Lovable Dashboard",
    Version: "3.22.0",
    Description: "Lovable.dev dashboard home-screen enhancements: search, nav controls, credit panel, workspace tools. Auto-injects only on the exact /dashboard URL.",
    World: "MAIN",
    IsGlobal: false,
    Dependencies: ["lovable-common"],
    LoadOrder: 40,
    Seed: {
        Id: "default-lovable-dashboard",
        SeedOnInstall: true,
        IsRemovable: false,
        AutoInject: true,
        RunAt: "document_idle",
        TargetUrls: [
            { Pattern: "https://lovable.dev/dashboard", MatchType: "exact" },
        ],
        Cookies: [],
        Settings: {},
    },
    Assets: {
        Css: [],
        Configs: [],
        Scripts: [
            { File: "lovable-dashboard.js", Order: 1, IsIife: true },
        ],
        Templates: [],
        Prompts: [],
    },
};

export default instruction;
