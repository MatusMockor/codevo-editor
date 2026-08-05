import { useCallback, useLayoutEffect, useRef } from "react";
import {
  classifyJavaScriptTypeScriptLargeDocumentCapability,
  classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics,
} from "../domain/javaScriptTypeScriptLargeDocumentCapability";
import {
  isLargeSmartDocumentContent,
  largeSmartDocumentStatusFromMetrics,
  normalizeLargeSmartDocumentPolicy,
  type LargeSmartDocumentMetrics,
  type LargeSmartDocumentPolicy,
  type LargeSmartDocumentStatus,
} from "../domain/largeDocumentPolicy";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../domain/languageServerDocumentSync";
import type { EditorDocument } from "../domain/workspace";
import { largeDocumentPresentationStatus } from "./editorSurfaceCore/useEditorSurfacePresentation";
import type { LargeSmartDocumentPresentationMode } from "./editorSurfaceCore/useLargeSmartDocumentMetricsLifecycle";

type ActiveDocumentChangeHandler = (
  content: string,
  sourcePath?: string,
  metrics?: LargeSmartDocumentMetrics,
) => boolean | void;

interface ActiveLargeDocumentPresentationOptions {
  readonly activeDocument: EditorDocument | null;
  readonly onChange: ActiveDocumentChangeHandler;
  readonly policy: LargeSmartDocumentPolicy;
  readonly workspaceRoot: string | null;
}

interface ActiveLargeDocumentPresentation {
  readonly onChange: ActiveDocumentChangeHandler;
  readonly status: LargeSmartDocumentStatus | null;
}

interface PresentationCache {
  readonly characterLimit: number;
  readonly content: string;
  readonly isJavaScriptTypeScript: boolean;
  readonly lineLimit: number;
  readonly mode: LargeSmartDocumentPresentationMode;
  readonly path: string;
  readonly stickyInvalidContent: boolean;
  readonly workspaceRoot: string | null;
}

interface CommittedPresentationContext {
  readonly activePath: string | undefined;
  readonly isJavaScriptTypeScript: boolean;
  readonly onChange: ActiveDocumentChangeHandler;
  readonly policy: LargeSmartDocumentPolicy;
  readonly workspaceRoot: string | null;
}

/**
 * Reuses Monaco's exact O(1) metrics for status-bar publications. Raw content
 * is inspected when a document authority is first observed or when malformed
 * content needs revalidation after an edit. Ordinary valid edit publications
 * never rescan the document.
 */
export function useAppActiveLargeDocumentPresentation({
  activeDocument,
  onChange,
  policy,
  workspaceRoot,
}: ActiveLargeDocumentPresentationOptions): ActiveLargeDocumentPresentation {
  const cacheRef = useRef<PresentationCache | null>(null);
  const committedContextRef = useRef<CommittedPresentationContext | null>(null);
  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);
  const activePath = activeDocument?.path;
  const isJavaScriptTypeScript = activeDocument
    ? isJavaScriptTypeScriptLanguageServerDocument(activeDocument)
    : false;
  const cached = resolvePresentationCache(
    cacheRef.current,
    activeDocument,
    isJavaScriptTypeScript,
    normalizedPolicy,
    workspaceRoot,
  );

  useLayoutEffect(() => {
    cacheRef.current = cached;
    committedContextRef.current = {
      activePath,
      isJavaScriptTypeScript,
      onChange,
      policy: {
        characterLimit: normalizedPolicy.characterLimit,
        lineLimit: normalizedPolicy.lineLimit,
      },
      workspaceRoot,
    };
  }, [
    activePath,
    cached,
    isJavaScriptTypeScript,
    normalizedPolicy.characterLimit,
    normalizedPolicy.lineLimit,
    onChange,
    workspaceRoot,
  ]);

  const handleChange = useCallback<ActiveDocumentChangeHandler>((content, sourcePath, metrics) => {
    const context = committedContextRef.current;
    if (!context) {
      return undefined;
    }
    const path = sourcePath ?? context.activePath;
    if (context.activePath && path === context.activePath) {
      cacheRef.current = presentationCacheFromMetrics(
        cacheRef.current,
        content,
        context.isJavaScriptTypeScript,
        metrics,
        context.policy,
        path,
        context.workspaceRoot,
      );
    }
    return context.onChange(content, sourcePath, metrics);
  }, []);

  return {
    onChange: handleChange,
    status: cached ? largeDocumentPresentationStatus(false, cached.mode) : null,
  };
}

function resolvePresentationCache(
  cached: PresentationCache | null,
  document: EditorDocument | null,
  isJavaScriptTypeScript: boolean,
  policy: LargeSmartDocumentPolicy,
  workspaceRoot: string | null,
): PresentationCache | null {
  if (!document) {
    return null;
  }
  if (
    cached?.workspaceRoot === workspaceRoot &&
    cached.path === document.path &&
    cached.content === document.content &&
    cached.isJavaScriptTypeScript === isJavaScriptTypeScript &&
    cached.characterLimit === policy.characterLimit &&
    cached.lineLimit === policy.lineLimit
  ) {
    return cached;
  }

  const capability = isJavaScriptTypeScript
    ? classifyJavaScriptTypeScriptLargeDocumentCapability(document.content, policy)
    : null;
  return {
    characterLimit: policy.characterLimit,
    content: document.content,
    isJavaScriptTypeScript,
    lineLimit: policy.lineLimit,
    mode: capability
      ? capability.kind === "full"
        ? "eligible"
        : capability.kind
      : isLargeSmartDocumentContent(document.content, policy)
        ? "large-non-javascript-typescript"
        : "eligible",
    path: document.path,
    stickyInvalidContent:
      capability?.kind === "editing-only" && capability.reason === "invalid-content",
    workspaceRoot,
  };
}

function presentationCacheFromMetrics(
  cached: PresentationCache | null,
  content: string,
  isJavaScriptTypeScript: boolean,
  metrics: LargeSmartDocumentMetrics | undefined,
  policy: LargeSmartDocumentPolicy,
  path: string,
  workspaceRoot: string | null,
): PresentationCache {
  const sameAuthority =
    cached?.workspaceRoot === workspaceRoot &&
    cached.path === path &&
    cached.isJavaScriptTypeScript === isJavaScriptTypeScript &&
    cached.characterLimit === policy.characterLimit &&
    cached.lineLimit === policy.lineLimit;
  const stickyInvalidContent = sameAuthority && cached.stickyInvalidContent;
  const exactMetrics = exactMetricsForContent(metrics, content);
  let mode: LargeSmartDocumentPresentationMode;
  let nextStickyInvalidContent = false;
  if (isJavaScriptTypeScript) {
    const repairedCapability = stickyInvalidContent
      ? classifyJavaScriptTypeScriptLargeDocumentCapability(content, policy)
      : null;
    const capability = classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics(
      exactMetrics,
      policy,
    );
    mode = repairedCapability
      ? repairedCapability.kind === "full"
        ? "eligible"
        : repairedCapability.kind
      : capability.kind === "full"
        ? "eligible"
        : capability.kind;
    nextStickyInvalidContent =
      repairedCapability?.kind === "editing-only" &&
      repairedCapability.reason === "invalid-content";
  } else {
    mode =
      largeSmartDocumentStatusFromMetrics(exactMetrics, policy).kind === "eligible"
        ? "eligible"
        : "large-non-javascript-typescript";
  }

  return {
    characterLimit: policy.characterLimit,
    content,
    isJavaScriptTypeScript,
    lineLimit: policy.lineLimit,
    mode,
    path,
    stickyInvalidContent: nextStickyInvalidContent,
    workspaceRoot,
  };
}

function exactMetricsForContent(
  metrics: LargeSmartDocumentMetrics | undefined,
  content: string,
): LargeSmartDocumentMetrics | undefined {
  try {
    return metrics?.utf16Length === content.length ? metrics : undefined;
  } catch {
    return undefined;
  }
}
