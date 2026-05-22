/**
 * Marco Extension — Database Schemas
 *
 * SQL CREATE TABLE statements for logs.db and errors.db.
 * All table names AND column names use PascalCase. No underscores allowed.
 *
 * ID CONVENTION: All primary key `Id` columns use INTEGER PRIMARY KEY AUTOINCREMENT.
 * TEXT/GUID identifiers are NEVER used as primary keys.
 * See: spec/02-coding-guidelines/coding-guidelines/database-id-convention.md
 */

/* ------------------------------------------------------------------ */
/*  Sessions & Logs (logs.db)                                          */
/* ------------------------------------------------------------------ */

const SESSIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS Sessions (
    Id        INTEGER PRIMARY KEY AUTOINCREMENT,
    StartedAt TEXT NOT NULL,
    EndedAt   TEXT,
    Version   TEXT NOT NULL,
    UserAgent TEXT,
    Notes     TEXT
);`;

const LOGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS Logs (
    Id         INTEGER PRIMARY KEY AUTOINCREMENT,
    SessionId  INTEGER NOT NULL,
    Timestamp  TEXT NOT NULL,
    Level      TEXT NOT NULL,
    Source     TEXT NOT NULL,
    Category   TEXT NOT NULL,
    Action     TEXT NOT NULL,
    LogType    TEXT,
    Indent     INTEGER DEFAULT 0,
    Detail     TEXT,
    Metadata   TEXT,
    DurationMs INTEGER,
    ProjectId  TEXT,
    UrlRuleId  TEXT,
    ScriptId   TEXT,
    ConfigId   TEXT,
    ExtVersion TEXT
);
CREATE INDEX IF NOT EXISTS IdxLogsSession   ON Logs(SessionId);
CREATE INDEX IF NOT EXISTS IdxLogsLevel     ON Logs(Level);
CREATE INDEX IF NOT EXISTS IdxLogsSource    ON Logs(Source);
CREATE INDEX IF NOT EXISTS IdxLogsCategory  ON Logs(Category);
CREATE INDEX IF NOT EXISTS IdxLogsTimestamp ON Logs(Timestamp);
CREATE INDEX IF NOT EXISTS IdxLogsProject   ON Logs(ProjectId);
CREATE INDEX IF NOT EXISTS IdxLogsScript    ON Logs(ScriptId);
`;

/* ------------------------------------------------------------------ */
/*  Errors (errors.db)                                                 */
/* ------------------------------------------------------------------ */

export const ERRORS_SCHEMA = `
CREATE TABLE IF NOT EXISTS Errors (
    Id          INTEGER PRIMARY KEY AUTOINCREMENT,
    SessionId   INTEGER NOT NULL,
    LogId       INTEGER,
    Timestamp   TEXT NOT NULL,
    Level       TEXT NOT NULL,
    Source      TEXT NOT NULL,
    Category    TEXT NOT NULL,
    ErrorCode   TEXT,
    Step        INTEGER,
    Xpath       TEXT,
    Message     TEXT NOT NULL,
    StackTrace  TEXT,
    Context     TEXT,
    Resolved    INTEGER DEFAULT 0,
    Resolution  TEXT,
    ProjectId   TEXT,
    UrlRuleId   TEXT,
    ScriptId    TEXT,
    ConfigId    TEXT,
    ScriptFile  TEXT,
    ErrorLine   INTEGER,
    ErrorColumn INTEGER,
    ExtVersion  TEXT
);
CREATE INDEX IF NOT EXISTS IdxErrorsSession  ON Errors(SessionId);
CREATE INDEX IF NOT EXISTS IdxErrorsCode     ON Errors(ErrorCode);
CREATE INDEX IF NOT EXISTS IdxErrorsLevel    ON Errors(Level);
CREATE INDEX IF NOT EXISTS IdxErrorsResolved ON Errors(Resolved);
CREATE INDEX IF NOT EXISTS IdxErrorsProject  ON Errors(ProjectId);
CREATE INDEX IF NOT EXISTS IdxErrorsScript   ON Errors(ScriptId);
`;

export const ERROR_CODES_SCHEMA = `
CREATE TABLE IF NOT EXISTS ErrorCodes (
    Code        TEXT PRIMARY KEY,
    Severity    TEXT NOT NULL,
    Description TEXT NOT NULL,
    Resolution  TEXT
);
`;

export const FULL_ERRORS_SCHEMA =
    ERRORS_SCHEMA +
    ERROR_CODES_SCHEMA;

/* ------------------------------------------------------------------ */
/*  Prompts (logs.db)                                                  */
/* ------------------------------------------------------------------ */

export const PROMPTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS Prompts (
    Id         INTEGER PRIMARY KEY AUTOINCREMENT,
    Slug       TEXT UNIQUE,
    Name       TEXT NOT NULL,
    Text       TEXT NOT NULL,
    Version    TEXT DEFAULT '1.0.0',
    SortOrder  INTEGER DEFAULT 0,
    IsDefault  INTEGER DEFAULT 0,
    IsFavorite INTEGER DEFAULT 0,
    CreatedAt  TEXT NOT NULL,
    UpdatedAt  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS IdxPromptsOrder ON Prompts(SortOrder);
CREATE INDEX IF NOT EXISTS IdxPromptsSlug  ON Prompts(Slug);
`;

/* ------------------------------------------------------------------ */
/*  PromptsCategory (logs.db)                                          */
/* ------------------------------------------------------------------ */

export const PROMPTS_CATEGORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS PromptsCategory (
    Id        INTEGER PRIMARY KEY AUTOINCREMENT,
    Name      TEXT NOT NULL UNIQUE,
    SortOrder INTEGER DEFAULT 0,
    CreatedAt TEXT NOT NULL
);
`;

/* ------------------------------------------------------------------ */
/*  PromptsToCategory — junction table (logs.db)                       */
/* ------------------------------------------------------------------ */

export const PROMPTS_TO_CATEGORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS PromptsToCategory (
    Id         INTEGER PRIMARY KEY AUTOINCREMENT,
    PromptId   INTEGER NOT NULL,
    CategoryId INTEGER NOT NULL,
    FOREIGN KEY (PromptId) REFERENCES Prompts(Id) ON DELETE CASCADE,
    FOREIGN KEY (CategoryId) REFERENCES PromptsCategory(Id) ON DELETE CASCADE,
    UNIQUE (PromptId, CategoryId)
);
CREATE INDEX IF NOT EXISTS IdxPtcPromptId   ON PromptsToCategory(PromptId);
CREATE INDEX IF NOT EXISTS IdxPtcCategoryId ON PromptsToCategory(CategoryId);
`;

/* ------------------------------------------------------------------ */
/*  PromptsDetails — view (logs.db)                                    */
/* ------------------------------------------------------------------ */

export const PROMPTS_DETAILS_VIEW = `
CREATE VIEW IF NOT EXISTS PromptsDetails AS
SELECT
    p.Id         AS PromptId,
    p.Slug       AS Slug,
    p.Name       AS Title,
    p.Text       AS Content,
    p.Version    AS Version,
    p.SortOrder  AS SortOrder,
    p.IsDefault  AS IsDefault,
    p.IsFavorite AS IsFavorite,
    p.CreatedAt  AS CreatedAt,
    p.UpdatedAt  AS UpdatedAt,
    COALESCE(
        GROUP_CONCAT(pc.Name, ', '),
        ''
    ) AS Categories
FROM Prompts p
LEFT JOIN PromptsToCategory ptc ON ptc.PromptId = p.Id
LEFT JOIN PromptsCategory pc   ON pc.Id = ptc.CategoryId
GROUP BY p.Id;
`;

/* ------------------------------------------------------------------ */
/*  Project Key-Value Store (logs.db)                                  */
/* ------------------------------------------------------------------ */

export const PROJECT_KV_SCHEMA = `
CREATE TABLE IF NOT EXISTS ProjectKv (
    ProjectId  TEXT NOT NULL,
    Key        TEXT NOT NULL,
    Value      TEXT NOT NULL,
    UpdatedAt  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (ProjectId, Key)
);
CREATE INDEX IF NOT EXISTS IdxKvProject ON ProjectKv(ProjectId);
`;

/* ------------------------------------------------------------------ */
/*  Project Files (logs.db)                                            */
/* ------------------------------------------------------------------ */

export const PROJECT_FILES_SCHEMA = `
CREATE TABLE IF NOT EXISTS ProjectFiles (
    Id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ProjectId TEXT NOT NULL,
    Filename  TEXT NOT NULL,
    MimeType  TEXT,
    Data      BLOB NOT NULL,
    Size      INTEGER,
    CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IdxFilesProject ON ProjectFiles(ProjectId);
`;

/* ------------------------------------------------------------------ */
/*  Settings (logs.db)                                                 */
/* ------------------------------------------------------------------ */

export const SETTINGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS Settings (
    Key       TEXT PRIMARY KEY,
    Value     TEXT NOT NULL,
    UpdatedAt TEXT DEFAULT (datetime('now'))
);
`;

/* ------------------------------------------------------------------ */
/*  GroupedKv (logs.db) — Issue 60                                     */
/* ------------------------------------------------------------------ */

export const GROUPED_KV_SCHEMA = `
CREATE TABLE IF NOT EXISTS GroupedKv (
    Id        INTEGER PRIMARY KEY AUTOINCREMENT,
    GroupName TEXT NOT NULL,
    Key       TEXT NOT NULL,
    Value     TEXT,
    UpdatedAt TEXT DEFAULT (datetime('now')),
    UNIQUE (GroupName, Key)
);
CREATE INDEX IF NOT EXISTS IdxGroupedKvGroup ON GroupedKv(GroupName);
`;


/* ------------------------------------------------------------------ */
/*  Scripts (logs.db)                                                  */
/* ------------------------------------------------------------------ */

export const SCRIPTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS Scripts (
    Id        INTEGER PRIMARY KEY AUTOINCREMENT,
    Name      TEXT NOT NULL,
    Code      TEXT,
    FilePath  TEXT,
    IsAbsolute INTEGER DEFAULT 0,
    IsEnabled INTEGER DEFAULT 1,
    ProjectId TEXT,
    SortOrder INTEGER DEFAULT 0,
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IdxScriptsProject ON Scripts(ProjectId);
`;

/* ------------------------------------------------------------------ */
/*  UpdaterInfo (logs.db)                                              */
/*  See: spec/05-chrome-extension/58-updater-system.md                 */
/*  See: spec/02-data-and-api/db-join-specs/01-category-join-pattern.md             */
/* ------------------------------------------------------------------ */

export const UPDATER_INFO_SCHEMA = `
CREATE TABLE IF NOT EXISTS UpdaterInfo (
    Id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    Name                        TEXT NOT NULL,
    Description                 TEXT,
    ScriptUrl                   TEXT NOT NULL,
    VersionInfoUrl              TEXT,
    InstructionUrl              TEXT,
    ChangelogUrl                TEXT,
    IsGit                       INTEGER DEFAULT 0,
    IsRedirectable              INTEGER DEFAULT 1,
    MaxRedirectDepth            INTEGER DEFAULT 2,
    IsInstructionRedirect       INTEGER DEFAULT 0,
    InstructionRedirectDepth    INTEGER DEFAULT 2,
    HasInstructions             INTEGER DEFAULT 0,
    HasChangelogFromVersionInfo INTEGER DEFAULT 1,
    HasUserConfirmBeforeUpdate  INTEGER DEFAULT 0,
    IsEnabled                   INTEGER DEFAULT 1,
    AutoCheckIntervalMinutes    INTEGER DEFAULT 1440,
    CacheExpiryMinutes          INTEGER DEFAULT 10080,
    CachedRedirectUrl           TEXT,
    CachedRedirectAt            TEXT,
    CurrentVersion              TEXT,
    LatestVersion               TEXT,
    LastCheckedAt               TEXT,
    LastUpdatedAt               TEXT,
    CreatedAt                   TEXT DEFAULT (datetime('now')),
    UpdatedAt                   TEXT DEFAULT (datetime('now'))
);
`;

/* ------------------------------------------------------------------ */
/*  UpdateSettings — global defaults (logs.db)                         */
/*  See: spec/05-chrome-extension/58-updater-system.md                 */
/* ------------------------------------------------------------------ */

export const UPDATE_SETTINGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS UpdateSettings (
    Id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    AutoCheckIntervalMinutes    INTEGER DEFAULT 1440,
    HasUserConfirmBeforeUpdate  INTEGER DEFAULT 0,
    HasChangelogFromVersionInfo INTEGER DEFAULT 1,
    CacheExpiryMinutes          INTEGER DEFAULT 10080,
    CreatedAt                   TEXT DEFAULT (datetime('now')),
    UpdatedAt                   TEXT DEFAULT (datetime('now'))
);
`;

/* ------------------------------------------------------------------ */
/*  UpdaterCategory (logs.db)                                          */
/* ------------------------------------------------------------------ */

export const UPDATER_CATEGORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS UpdaterCategory (
    Id        INTEGER PRIMARY KEY AUTOINCREMENT,
    Name      TEXT NOT NULL UNIQUE,
    SortOrder INTEGER DEFAULT 0,
    CreatedAt TEXT DEFAULT (datetime('now'))
);
`;

/* ------------------------------------------------------------------ */
/*  UpdaterToCategory — junction table (logs.db)                       */
/* ------------------------------------------------------------------ */

export const UPDATER_TO_CATEGORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS UpdaterToCategory (
    Id         INTEGER PRIMARY KEY AUTOINCREMENT,
    UpdaterId  INTEGER NOT NULL,
    CategoryId INTEGER NOT NULL,
    FOREIGN KEY (UpdaterId) REFERENCES UpdaterInfo(Id) ON DELETE CASCADE,
    FOREIGN KEY (CategoryId) REFERENCES UpdaterCategory(Id) ON DELETE CASCADE,
    UNIQUE (UpdaterId, CategoryId)
);
CREATE INDEX IF NOT EXISTS IdxUtcUpdater   ON UpdaterToCategory(UpdaterId);
CREATE INDEX IF NOT EXISTS IdxUtcCategory  ON UpdaterToCategory(CategoryId);
`;

/* ------------------------------------------------------------------ */
/*  UpdaterEndpoints (logs.db)                                         */
/* ------------------------------------------------------------------ */

export const UPDATER_ENDPOINTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS UpdaterEndpoints (
    Id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    UpdaterId          INTEGER NOT NULL,
    Url                TEXT NOT NULL,
    SortOrder          INTEGER DEFAULT 0,
    ExpectedStatusCode INTEGER DEFAULT 200,
    IsRedirectable     INTEGER DEFAULT 0,
    MaxRedirectDepth   INTEGER DEFAULT 2,
    FOREIGN KEY (UpdaterId) REFERENCES UpdaterInfo(Id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS IdxUpdaterEndpointsUpdater ON UpdaterEndpoints(UpdaterId);
`;

/* ------------------------------------------------------------------ */
/*  UpdaterSteps (logs.db)                                             */
/* ------------------------------------------------------------------ */

export const UPDATER_STEPS_SCHEMA = `
CREATE TABLE IF NOT EXISTS UpdaterSteps (
    Id               INTEGER PRIMARY KEY AUTOINCREMENT,
    UpdaterId        INTEGER NOT NULL,
    StepId           TEXT NOT NULL,
    SortOrder        INTEGER DEFAULT 0,
    Type             TEXT NOT NULL,
    Condition        TEXT,
    ResourceType     TEXT,
    SourceUrl        TEXT,
    ExpectedStatus   INTEGER DEFAULT 200,
    IsRedirectable   INTEGER DEFAULT 0,
    MaxRedirectDepth INTEGER DEFAULT 2,
    Destination      TEXT,
    PostProcess      TEXT,
    ExecutionCommand TEXT,
    ValidationRule   TEXT,
    FOREIGN KEY (UpdaterId) REFERENCES UpdaterInfo(Id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS IdxUpdaterStepsUpdater ON UpdaterSteps(UpdaterId);
`;

/* ------------------------------------------------------------------ */
/*  UpdaterDetails — view (logs.db)                                    */
/* ------------------------------------------------------------------ */

export const UPDATER_DETAILS_VIEW = `
CREATE VIEW IF NOT EXISTS UpdaterDetails AS
SELECT
    u.Id                            AS UpdaterId,
    u.Name                          AS Name,
    u.Description                   AS Description,
    u.ScriptUrl                     AS ScriptUrl,
    u.VersionInfoUrl                AS VersionInfoUrl,
    u.InstructionUrl                AS InstructionUrl,
    u.ChangelogUrl                  AS ChangelogUrl,
    u.IsGit                         AS IsGit,
    u.IsRedirectable                AS IsRedirectable,
    u.MaxRedirectDepth              AS MaxRedirectDepth,
    u.IsInstructionRedirect         AS IsInstructionRedirect,
    u.InstructionRedirectDepth      AS InstructionRedirectDepth,
    u.HasInstructions               AS HasInstructions,
    u.HasChangelogFromVersionInfo   AS HasChangelogFromVersionInfo,
    u.HasUserConfirmBeforeUpdate    AS HasUserConfirmBeforeUpdate,
    u.IsEnabled                     AS IsEnabled,
    u.AutoCheckIntervalMinutes      AS AutoCheckIntervalMinutes,
    u.CacheExpiryMinutes            AS CacheExpiryMinutes,
    u.CachedRedirectUrl             AS CachedRedirectUrl,
    u.CachedRedirectAt              AS CachedRedirectAt,
    u.CurrentVersion                AS CurrentVersion,
    u.LatestVersion                 AS LatestVersion,
    u.LastCheckedAt                 AS LastCheckedAt,
    u.LastUpdatedAt                 AS LastUpdatedAt,
    u.CreatedAt                     AS CreatedAt,
    u.UpdatedAt                     AS UpdatedAt,
    COALESCE(GROUP_CONCAT(uc.Name, ', '), '') AS Categories
FROM UpdaterInfo u
LEFT JOIN UpdaterToCategory utc ON utc.UpdaterId = u.Id
LEFT JOIN UpdaterCategory uc   ON uc.Id = utc.CategoryId
GROUP BY u.Id;
`;

/* ------------------------------------------------------------------ */
/*  DynamicLoadLog (logs.db) — Dynamic Script Loading                  */
/* ------------------------------------------------------------------ */

export const DYNAMIC_LOAD_LOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS DynamicLoadLog (
    Id          INTEGER PRIMARY KEY AUTOINCREMENT,
    Timestamp   TEXT    NOT NULL,
    Requester   TEXT    NOT NULL,
    Target      TEXT    NOT NULL,
    Status      TEXT    NOT NULL,
    Detail      TEXT,
    ExtVersion  TEXT
);
CREATE INDEX IF NOT EXISTS IdxDynLoadTimestamp ON DynamicLoadLog(Timestamp);
CREATE INDEX IF NOT EXISTS IdxDynLoadRequester ON DynamicLoadLog(Requester);
CREATE INDEX IF NOT EXISTS IdxDynLoadStatus    ON DynamicLoadLog(Status);
`;

/* ------------------------------------------------------------------ */
/*  SharedAsset (logs.db) — Cross-Project Sync                         */
/*  See: spec/21-app/02-features/misc-features/cross-project-sync.md                        */
/* ------------------------------------------------------------------ */

export const SHARED_ASSET_SCHEMA = `
CREATE TABLE IF NOT EXISTS SharedAsset (
    Id          INTEGER PRIMARY KEY AUTOINCREMENT,
    Type        TEXT NOT NULL CHECK(Type IN ('prompt','script','chain','preset')),
    Name        TEXT NOT NULL,
    Slug        TEXT UNIQUE NOT NULL,
    ContentJson TEXT NOT NULL,
    ContentHash TEXT NOT NULL,
    Version     TEXT NOT NULL DEFAULT '1.0.0',
    CreatedAt   TEXT DEFAULT (datetime('now')),
    UpdatedAt   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IdxSharedAssetType ON SharedAsset(Type);
CREATE INDEX IF NOT EXISTS IdxSharedAssetSlug ON SharedAsset(Slug);
`;

/* ------------------------------------------------------------------ */
/*  AssetLink (logs.db) — Cross-Project Sync                           */
/* ------------------------------------------------------------------ */

export const ASSET_LINK_SCHEMA = `
CREATE TABLE IF NOT EXISTS AssetLink (
    Id               INTEGER PRIMARY KEY AUTOINCREMENT,
    SharedAssetId    INTEGER NOT NULL REFERENCES SharedAsset(Id) ON DELETE CASCADE,
    ProjectId        INTEGER NOT NULL,
    LinkState        TEXT NOT NULL DEFAULT 'synced' CHECK(LinkState IN ('synced','pinned','detached')),
    PinnedVersion    TEXT,
    LocalOverrideJson TEXT,
    SyncedAt         TEXT DEFAULT (datetime('now')),
    UNIQUE(SharedAssetId, ProjectId)
);
CREATE INDEX IF NOT EXISTS IdxAssetLinkProject ON AssetLink(ProjectId);
CREATE INDEX IF NOT EXISTS IdxAssetLinkShared  ON AssetLink(SharedAssetId);
`;

/* ------------------------------------------------------------------ */
/*  ProjectGroup (logs.db) — Cross-Project Sync                        */
/* ------------------------------------------------------------------ */

export const PROJECT_GROUP_SCHEMA = `
CREATE TABLE IF NOT EXISTS ProjectGroup (
    Id                INTEGER PRIMARY KEY AUTOINCREMENT,
    Name              TEXT NOT NULL,
    SharedSettingsJson TEXT,
    CreatedAt         TEXT DEFAULT (datetime('now'))
);
`;

/* ------------------------------------------------------------------ */
/*  ProjectGroupMember (logs.db) — Cross-Project Sync                  */
/* ------------------------------------------------------------------ */

export const PROJECT_GROUP_MEMBER_SCHEMA = `
CREATE TABLE IF NOT EXISTS ProjectGroupMember (
    Id            INTEGER PRIMARY KEY AUTOINCREMENT,
    GroupId       INTEGER NOT NULL REFERENCES ProjectGroup(Id) ON DELETE CASCADE,
    ProjectIdUuid TEXT NOT NULL,
    UNIQUE(GroupId, ProjectIdUuid)
);
CREATE INDEX IF NOT EXISTS IdxGroupMemberProject ON ProjectGroupMember(ProjectIdUuid);
`;

/* ------------------------------------------------------------------ */
/*  Combined                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  AssetVersion (logs.db) — Version History for Cross-Project Sync    */
/* ------------------------------------------------------------------ */

export const ASSET_VERSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS AssetVersion (
    Id            INTEGER PRIMARY KEY AUTOINCREMENT,
    SharedAssetId INTEGER NOT NULL REFERENCES SharedAsset(Id) ON DELETE CASCADE,
    Version       TEXT NOT NULL,
    ContentJson   TEXT NOT NULL,
    ContentHash   TEXT NOT NULL,
    ChangedBy     TEXT DEFAULT 'user',
    CreatedAt     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IdxAssetVersionAsset ON AssetVersion(SharedAssetId);
CREATE INDEX IF NOT EXISTS IdxAssetVersionCreated ON AssetVersion(SharedAssetId, CreatedAt DESC);
`;

export const FULL_LOGS_SCHEMA =
    SESSIONS_SCHEMA +
    LOGS_SCHEMA +
    SETTINGS_SCHEMA +
    PROMPTS_SCHEMA +
    PROMPTS_CATEGORY_SCHEMA +
    PROMPTS_TO_CATEGORY_SCHEMA +
    PROJECT_KV_SCHEMA +
    PROJECT_FILES_SCHEMA +
    SCRIPTS_SCHEMA +
    GROUPED_KV_SCHEMA +
    UPDATER_INFO_SCHEMA +
    UPDATE_SETTINGS_SCHEMA +
    UPDATER_CATEGORY_SCHEMA +
    UPDATER_TO_CATEGORY_SCHEMA +
    UPDATER_ENDPOINTS_SCHEMA +
    UPDATER_STEPS_SCHEMA +
    DYNAMIC_LOAD_LOG_SCHEMA +
    PROMPTS_DETAILS_VIEW +
    UPDATER_DETAILS_VIEW +
    SHARED_ASSET_SCHEMA +
    ASSET_LINK_SCHEMA +
    PROJECT_GROUP_SCHEMA +
    PROJECT_GROUP_MEMBER_SCHEMA +
    ASSET_VERSION_SCHEMA;
