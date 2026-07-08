import { useCallback, useRef, type MutableRefObject } from "react";
import type { PhpLaravelConfigTarget } from "../domain/phpLaravelConfig";
import type { PhpLaravelTranslationTarget } from "../domain/phpLaravelTranslations";
import type { PhpLaravelViewTarget } from "../domain/phpLaravelViews";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

const PHP_LARAVEL_TARGET_CACHE_TTL_MS = 30_000;

// Laravel config/view/translation completions can require expensive directory
// scans (recursive resources/views walk, reads of every config/*.php and lang
// file). The targets only change when files change, so they are memoized per
// workspace root with a short TTL. The stale-root guard below keeps the cache
// isolated across project tabs and prevents late async results from populating
// another active workspace.
interface PhpLaravelTargetCacheEntry<T> {
  expiresAt: number;
  targets: T[];
}

interface PhpLaravelTargetCacheBucket {
  config?: PhpLaravelTargetCacheEntry<PhpLaravelConfigTarget>;
  translations?: PhpLaravelTargetCacheEntry<PhpLaravelTranslationTarget>;
  views?: PhpLaravelTargetCacheEntry<PhpLaravelViewTarget>;
}

interface PhpLaravelTargetCache {
  read: <Kind extends keyof PhpLaravelTargetCacheBucket>(
    requestedRoot: string,
    kind: Kind,
  ) => NonNullable<PhpLaravelTargetCacheBucket[Kind]>["targets"] | null;
  write: <Kind extends keyof PhpLaravelTargetCacheBucket>(
    requestedRoot: string,
    kind: Kind,
    targets: NonNullable<PhpLaravelTargetCacheBucket[Kind]>["targets"],
  ) => void;
  invalidate: () => void;
}

export function usePhpLaravelTargetCache(
  currentWorkspaceRootRef: MutableRefObject<string | null>,
): PhpLaravelTargetCache {
  const cacheRef = useRef<Record<string, PhpLaravelTargetCacheBucket>>({});

  const read = useCallback(
    <Kind extends keyof PhpLaravelTargetCacheBucket>(
      requestedRoot: string,
      kind: Kind,
    ): NonNullable<PhpLaravelTargetCacheBucket[Kind]>["targets"] | null => {
      // Only serve cached targets while the requested root is still the active
      // workspace; never let a stale tab's cache satisfy another tab's request.
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return null;
      }

      const entry = cacheRef.current[requestedRoot]?.[kind];

      if (!entry || entry.expiresAt <= Date.now()) {
        return null;
      }

      return entry.targets as NonNullable<
        PhpLaravelTargetCacheBucket[Kind]
      >["targets"];
    },
    [currentWorkspaceRootRef],
  );

  const write = useCallback(
    <Kind extends keyof PhpLaravelTargetCacheBucket>(
      requestedRoot: string,
      kind: Kind,
      targets: NonNullable<PhpLaravelTargetCacheBucket[Kind]>["targets"],
    ): void => {
      // Drop results computed for a root that is no longer active so the cache
      // can never be populated with another tab's targets.
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      const bucket = cacheRef.current[requestedRoot] ?? {};

      cacheRef.current[requestedRoot] = {
        ...bucket,
        [kind]: {
          expiresAt: Date.now() + PHP_LARAVEL_TARGET_CACHE_TTL_MS,
          targets,
        },
      };
    },
    [currentWorkspaceRootRef],
  );

  const invalidate = useCallback(() => {
    cacheRef.current = {};
  }, []);

  return { read, write, invalidate };
}
