/**
 * Payment Banner Hider — Project Instruction Manifest
 *
 * Auto-injected global script. Hides the Lovable "Payment issue detected"
 * sticky banner on lovable.dev/* pages with a smooth CSS3 fade.
 *
 * All keys PascalCase per `mem://standards/pascalcase-json-keys`.
 */

import type { ProjectInstruction } from "../../types/instruction/project-instruction";
import type { EmptySettings } from "../../types/instruction/seed/empty-settings";

const instruction: ProjectInstruction<EmptySettings> = {
    SchemaVersion: "1.0",
    Name: "payment-banner-hider",
    DisplayName: "Payment Banner Hider",
    Version: "2.231.0",
    Description: "Auto-hides the Lovable 'Payment issue detected.' sticky banner with a smooth CSS3 fade.",
    World: "MAIN",
    IsGlobal: true,
    Dependencies: [],
    LoadOrder: 2,
    Seed: {
        Id: "default-payment-banner-hider",
        SeedOnInstall: true,
        IsRemovable: true,
        AutoInject: true,
        RunAt: "document_idle",
        TargetUrls: [
            { Pattern: "https://lovable.dev/*", MatchType: "glob" },
        ],
        Cookies: [],
        Settings: {},
    },
    Assets: {
        Css: [
            { File: "payment-banner-hider.css", Inject: "head" },
        ],
        Configs: [],
        Scripts: [
            { File: "payment-banner-hider.js", Order: 1, IsIife: true },
        ],
        Templates: [],
        Prompts: [],
    },
};

export default instruction;
