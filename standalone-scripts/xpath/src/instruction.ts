/**
 * XPath Utilities — Project Instruction Manifest
 *
 * Global utility library. No configs, no CSS, just the JS bundle.
 * Loaded before all dependent projects.
 *
 * All keys PascalCase per `mem://standards/pascalcase-json-keys`.
 */

import type { ProjectInstruction } from "../../types/instruction/project-instruction";
import type { EmptySettings } from "../../types/instruction/seed/empty-settings";

const instruction: ProjectInstruction<EmptySettings> = {
    SchemaVersion: "1.0",
    Name: "xpath",
    DisplayName: "XPath Utilities",
    Version: "2.239.0",
    Description: "Global XPath utility library (getByXPath, findElement, reactClick)",
    World: "MAIN",
    IsGlobal: true,
    Dependencies: [],
    LoadOrder: 1,
    Seed: {
        Id: "default-xpath-utils",
        SeedOnInstall: true,
        IsRemovable: false,
        AutoInject: true,
        TargetUrls: [
            { Pattern: "https://lovable.dev/projects/*", MatchType: "glob" },
            { Pattern: "https://*.lovable.app/*", MatchType: "glob" },
            { Pattern: "https://*.lovableproject.com/*", MatchType: "glob" },
        ],
        Cookies: [],
        Settings: {},
    },
    Assets: {
        Css: [],
        Configs: [],
        Scripts: [
            { File: "xpath.js", Order: 1, IsIife: true },
        ],
        Templates: [],
        Prompts: [],
    },
};

export default instruction;
