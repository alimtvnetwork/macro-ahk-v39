/**
 * Marco SDK — Project Instruction Manifest
 *
 * Global shared SDK. Injected first (LoadOrder: 0) into MAIN world.
 * Creates and freezes `window.marco` namespace.
 *
 * All keys PascalCase per `mem://standards/pascalcase-json-keys`.
 */

import type { ProjectInstruction } from "../../types/instruction/project-instruction";
import type { EmptySettings } from "../../types/instruction/seed/empty-settings";

const LOVABLE_BASE_URL = "https://lovable.dev";

const instruction: ProjectInstruction<{ OnlyRunAsDependency: boolean }> = {
    SchemaVersion: "1.0",
    Name: "marco-sdk",
    DisplayName: "Rise Up Macro SDK",
    Version: "3.17.1",
    Description: "Core SDK — creates and freezes window.marco namespace",
    World: "MAIN",
    IsGlobal: true,
    Dependencies: [],
    LoadOrder: 0,
    Seed: {
        Id: "default-marco-sdk",
        SeedOnInstall: true,
        IsRemovable: false,
        AutoInject: true,
        RunAt: "document_start",
        TargetUrls: [
            { Pattern: "https://lovable.dev/projects/*", MatchType: "glob" },
            { Pattern: "https://*.lovable.app/*", MatchType: "glob" },
            { Pattern: "https://*.lovableproject.com/*", MatchType: "glob" },
        ],
        Cookies: [
            { CookieName: "lovable-session-id.id", Url: LOVABLE_BASE_URL, Role: "session", Description: "Primary session cookie — JWT bearer token" },
            { CookieName: "lovable-session-id.refresh", Url: LOVABLE_BASE_URL, Role: "refresh", Description: "Refresh token cookie" },
            { CookieName: "__Secure-lovable-session-id.id", Url: LOVABLE_BASE_URL, Role: "session", Description: "Secure-prefixed session cookie alias" },
            { CookieName: "__Host-lovable-session-id.id", Url: LOVABLE_BASE_URL, Role: "session", Description: "Host-prefixed session cookie alias" },
        ],
        Settings: { OnlyRunAsDependency: true },
    },
    Assets: {
        Css: [],
        Configs: [],
        Scripts: [
            { File: "marco-sdk.js", Order: 1, IsIife: true },
        ],
        Templates: [],
        Prompts: [],
    },
};

// Re-export the empty-settings alias for downstream scripts that
// previously imported it from this file's legacy `SeedBlock` type.
export type { EmptySettings };

export default instruction;
