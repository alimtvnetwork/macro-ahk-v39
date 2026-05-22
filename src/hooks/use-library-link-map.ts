/**
 * Hook: useLibraryLinkMap
 *
 * Fetches all SharedAssets and AssetLinks, then builds lookup maps:
 * - assetSlugMap: slug → exists in library (for global prompt/script lists)
 * - projectLinkMap: slug → { state, pinnedVersion } for a specific project
 *
 * Used by PromptRow and ScriptEntryCard to show inline SyncBadge.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { sendMessage } from "@/lib/message-client";
import { logError } from "./hook-logger";

export type LinkState = "synced" | "pinned" | "detached";

export interface LinkInfo {
  state: LinkState;
  pinnedVersion: string | null;
  updateAvailable: boolean;
}

interface SharedAssetMinimal {
  Id: number;
  Slug: string;
  Type: string;
  Version: string;
}

interface AssetLinkMinimal {
  SharedAssetId: number;
  ProjectId: number;
  LinkState: LinkState;
  PinnedVersion: string | null;
}

/** Map of asset slug → LinkInfo */
export type LibraryLinkMap = Map<string, LinkInfo>;

/** Set of slugs that exist in the library */
export type LibraryAssetSet = Set<string>;

// eslint-disable-next-line max-lines-per-function -- 42 lines, slightly over hook limit of 40
export function useLibraryLinkMap(projectId?: number | null): {
  linkMap: LibraryLinkMap;
  assetSlugs: LibraryAssetSet;
  loading: boolean;
} {
  const [assets, setAssets] = useState<SharedAssetMinimal[]>([]);
  const [links, setLinks] = useState<AssetLinkMinimal[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [assetsRes, linksRes] = await Promise.all([
        sendMessage<{ assets: SharedAssetMinimal[] }>({ type: "LIBRARY_GET_ASSETS" as never }),
        sendMessage<{ links: AssetLinkMinimal[] }>({ type: "LIBRARY_GET_LINKS" as never }),
      ]);
      setAssets(assetsRes.assets ?? []);
      setLinks(linksRes.links ?? []);
    } catch (caught) {
      logError("useLibraryLinkMap.load", "LIBRARY_GET_ASSETS/LIBRARY_GET_LINKS failed — link badges will be empty until next reload", caught);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const assetSlugs = useMemo(() => new Set(assets.map(a => a.Slug)), [assets]);

  const linkMap = useMemo(() => {
    const map = new Map<string, LinkInfo>();
    if (!projectId) return map;

    const projectLinks = links.filter(l => l.ProjectId === projectId);
    const assetById = new Map(assets.map(a => [a.Id, a]));

    for (const link of projectLinks) {
      const asset = assetById.get(link.SharedAssetId);
      if (asset) {
        const updateAvailable = link.LinkState === "pinned"
          && link.PinnedVersion !== null
          && asset.Version !== link.PinnedVersion;
        map.set(asset.Slug, { state: link.LinkState, pinnedVersion: link.PinnedVersion, updateAvailable });
      }
    }
    return map;
  }, [assets, links, projectId]);

  return { linkMap, assetSlugs, loading };
}
