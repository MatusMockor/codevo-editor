import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  isLargeSmartDocumentContent,
  largeSmartDocumentStatusFromMetrics,
  type LargeSmartDocumentMetrics,
  type LargeSmartDocumentPolicy,
} from "../../domain/largeDocumentPolicy";

interface CachedModelContentMetrics {
  readonly content: string;
  readonly metrics: LargeSmartDocumentMetrics;
  readonly path: string;
  readonly workspaceRoot: string | null;
}

interface LargeSmartDocumentMetricsLifecycleOptions {
  readonly content: string | undefined;
  readonly onChangeRef: {
    readonly current: (
      content: string,
      path?: string,
      metrics?: LargeSmartDocumentMetrics,
    ) => boolean | void;
  };
  readonly path: string | undefined;
  readonly policy: LargeSmartDocumentPolicy;
  readonly workspaceRoot: string | null;
}

interface LargeSmartDocumentMetricsLifecycle {
  readonly activeDocumentIsLargeSmart: boolean;
  onModelContentChange(
    content: string,
    path: string | undefined,
    metrics: LargeSmartDocumentMetrics | undefined,
  ): void;
}

/**
 * Retains Monaco's O(1) content metrics only for the exact content publication
 * that produced them. Path/root switches and content reversals fail closed to
 * the authoritative content scan instead of borrowing another model revision.
 */
export function useLargeSmartDocumentMetricsLifecycle({
  content,
  onChangeRef,
  path,
  policy,
  workspaceRoot,
}: LargeSmartDocumentMetricsLifecycleOptions): LargeSmartDocumentMetricsLifecycle {
  const latestMetricsRef = useRef<CachedModelContentMetrics | null>(null);
  const characterLimit = policy.characterLimit;
  const lineLimit = policy.lineLimit;
  const activeDocumentIsLargeSmart = useMemo(() => {
    if (content === undefined || !path) {
      return false;
    }
    const latest = latestMetricsRef.current;
    if (
      latest?.workspaceRoot === workspaceRoot &&
      latest.path === path &&
      latest.content === content
    ) {
      return (
        largeSmartDocumentStatusFromMetrics(latest.metrics, { characterLimit, lineLimit }).kind !==
        "eligible"
      );
    }
    return isLargeSmartDocumentContent(content, { characterLimit, lineLimit });
  }, [characterLimit, content, lineLimit, path, workspaceRoot]);

  useLayoutEffect(() => {
    const latest = latestMetricsRef.current;
    if (
      latest &&
      (latest.workspaceRoot !== workspaceRoot || latest.path !== path || latest.content !== content)
    ) {
      latestMetricsRef.current = null;
    }
  }, [content, path, workspaceRoot]);

  const onModelContentChange = useCallback(
    (
      nextContent: string,
      nextPath: string | undefined,
      metrics: LargeSmartDocumentMetrics | undefined,
    ) => {
      latestMetricsRef.current =
        nextPath && metrics?.utf16Length === nextContent.length
          ? { content: nextContent, metrics, path: nextPath, workspaceRoot }
          : null;
      return onChangeRef.current(nextContent, nextPath, metrics);
    },
    [onChangeRef, workspaceRoot],
  );

  return { activeDocumentIsLargeSmart, onModelContentChange };
}
