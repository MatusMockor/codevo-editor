import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  isLargeSmartDocumentContent,
  largeSmartDocumentStatusFromMetrics,
  type LargeSmartDocumentMetrics,
  type LargeSmartDocumentPolicy,
} from "../../domain/largeDocumentPolicy";
import {
  classifyJavaScriptTypeScriptLargeDocumentCapability,
  classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics,
} from "../../domain/javaScriptTypeScriptLargeDocumentCapability";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../../domain/languageServerDocumentSync";
import type { EditorDocument } from "../../domain/workspace";

interface CachedModelContentMetrics {
  readonly content: string;
  readonly metrics: LargeSmartDocumentMetrics;
  readonly path: string;
  readonly workspaceRoot: string | null;
}

interface InvalidRawAdmissionOwner {
  readonly content: string;
  readonly path: string;
  readonly workspaceRoot: string | null;
}

interface LargeSmartDocumentPresentationAssessment {
  readonly invalidRawAdmission: boolean;
  readonly mode: LargeSmartDocumentPresentationMode;
}

interface LargeSmartDocumentMetricsLifecycleOptions {
  readonly document: EditorDocument | null;
  readonly onChangeRef: {
    readonly current: (
      content: string,
      path?: string,
      metrics?: LargeSmartDocumentMetrics,
    ) => boolean | void;
  };
  readonly policy: LargeSmartDocumentPolicy;
  readonly workspaceRoot?: string | null;
}

interface LargeSmartDocumentMetricsLifecycle {
  readonly activeDocumentIsLargeSmart: boolean;
  readonly activeDocumentLargeSmartMode: LargeSmartDocumentPresentationMode;
  onModelContentChange(
    content: string,
    path: string | undefined,
    metrics: LargeSmartDocumentMetrics | undefined,
  ): void;
}

export type LargeSmartDocumentPresentationMode =
  | "editing-degraded-interactive-lsp"
  | "editing-only"
  | "eligible"
  | "large-non-javascript-typescript";

/**
 * Retains Monaco's O(1) content metrics only for the exact content publication
 * that produced them. Path/root switches and content reversals fail closed to
 * the authoritative content scan instead of borrowing another model revision.
 */
export function useLargeSmartDocumentMetricsLifecycle({
  document,
  onChangeRef,
  policy,
  workspaceRoot,
}: LargeSmartDocumentMetricsLifecycleOptions): LargeSmartDocumentMetricsLifecycle {
  const latestMetricsRef = useRef<CachedModelContentMetrics | null>(null);
  const invalidRawAdmissionOwnerRef = useRef<InvalidRawAdmissionOwner | null>(null);
  const normalizedWorkspaceRoot = workspaceRoot ?? null;
  const content = document?.content;
  const path = document?.path;
  const isJavaScriptTypeScriptDocument =
    document !== null && isJavaScriptTypeScriptLanguageServerDocument(document);
  const characterLimit = policy.characterLimit;
  const lineLimit = policy.lineLimit;
  const presentationAssessment = useMemo<LargeSmartDocumentPresentationAssessment>(() => {
    if (content === undefined || !path) {
      return { invalidRawAdmission: false, mode: "eligible" };
    }
    const latest = latestMetricsRef.current;
    if (
      latest?.workspaceRoot === normalizedWorkspaceRoot &&
      latest.path === path &&
      latest.content === content
    ) {
      if (isJavaScriptTypeScriptDocument) {
        const invalidRawAdmissionOwner = invalidRawAdmissionOwnerRef.current;
        return {
          invalidRawAdmission: false,
          mode:
            invalidRawAdmissionOwner?.workspaceRoot === normalizedWorkspaceRoot &&
            invalidRawAdmissionOwner.path === path &&
            invalidRawAdmissionOwner.content === content
              ? "editing-only"
              : javaScriptTypeScriptPresentationMode(
                  classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics(latest.metrics, {
                    characterLimit,
                    lineLimit,
                  }).kind,
                ),
        };
      }
      return {
        invalidRawAdmission: false,
        mode:
          largeSmartDocumentStatusFromMetrics(latest.metrics, { characterLimit, lineLimit })
            .kind === "eligible"
            ? "eligible"
            : "large-non-javascript-typescript",
      };
    }
    return largeSmartDocumentPresentationAssessmentFromContent(
      content,
      isJavaScriptTypeScriptDocument,
      { characterLimit, lineLimit },
    );
  }, [
    characterLimit,
    content,
    isJavaScriptTypeScriptDocument,
    lineLimit,
    normalizedWorkspaceRoot,
    path,
  ]);
  const activeDocumentLargeSmartMode = presentationAssessment.mode;
  const activeDocumentIsLargeSmart = activeDocumentLargeSmartMode !== "eligible";

  useLayoutEffect(() => {
    const latest = latestMetricsRef.current;
    if (
      latest &&
      (latest.workspaceRoot !== normalizedWorkspaceRoot ||
        latest.path !== path ||
        latest.content !== content)
    ) {
      latestMetricsRef.current = null;
    }
    const invalidRawAdmissionOwner = invalidRawAdmissionOwnerRef.current;
    if (
      invalidRawAdmissionOwner &&
      (invalidRawAdmissionOwner.workspaceRoot !== normalizedWorkspaceRoot ||
        invalidRawAdmissionOwner.path !== path ||
        invalidRawAdmissionOwner.content !== content)
    ) {
      invalidRawAdmissionOwnerRef.current = null;
    }
    if (presentationAssessment.invalidRawAdmission && content !== undefined && path) {
      invalidRawAdmissionOwnerRef.current = {
        content,
        path,
        workspaceRoot: normalizedWorkspaceRoot,
      };
    }
  }, [content, normalizedWorkspaceRoot, path, presentationAssessment.invalidRawAdmission]);

  const onModelContentChange = useCallback(
    (
      nextContent: string,
      nextPath: string | undefined,
      metrics: LargeSmartDocumentMetrics | undefined,
    ) => {
      const invalidRawAdmissionOwner = invalidRawAdmissionOwnerRef.current;
      if (
        invalidRawAdmissionOwner?.workspaceRoot === normalizedWorkspaceRoot &&
        invalidRawAdmissionOwner.path === nextPath &&
        invalidRawAdmissionOwner.content !== nextContent
      ) {
        const nextCapability = classifyJavaScriptTypeScriptLargeDocumentCapability(nextContent, {
          characterLimit,
          lineLimit,
        });
        invalidRawAdmissionOwnerRef.current =
          nextCapability.kind === "editing-only" &&
          (nextCapability.reason === "invalid-content" ||
            nextCapability.reason === "full-sync-utf16-limit")
            ? {
                content: nextContent,
                path: nextPath,
                workspaceRoot: normalizedWorkspaceRoot,
              }
            : null;
      }
      latestMetricsRef.current =
        nextPath && metrics?.utf16Length === nextContent.length
          ? {
              content: nextContent,
              metrics,
              path: nextPath,
              workspaceRoot: normalizedWorkspaceRoot,
            }
          : null;
      return onChangeRef.current(nextContent, nextPath, metrics);
    },
    [characterLimit, lineLimit, normalizedWorkspaceRoot, onChangeRef],
  );

  return { activeDocumentIsLargeSmart, activeDocumentLargeSmartMode, onModelContentChange };
}

export function largeSmartDocumentPresentationModeFromContent(
  content: string,
  isJavaScriptTypeScriptDocument: boolean,
  policy: LargeSmartDocumentPolicy,
): LargeSmartDocumentPresentationMode {
  return largeSmartDocumentPresentationAssessmentFromContent(
    content,
    isJavaScriptTypeScriptDocument,
    policy,
  ).mode;
}

function largeSmartDocumentPresentationAssessmentFromContent(
  content: string,
  isJavaScriptTypeScriptDocument: boolean,
  policy: LargeSmartDocumentPolicy,
): LargeSmartDocumentPresentationAssessment {
  if (isJavaScriptTypeScriptDocument) {
    const capability = classifyJavaScriptTypeScriptLargeDocumentCapability(content, policy);
    return {
      invalidRawAdmission:
        capability.kind === "editing-only" && capability.reason === "invalid-content",
      mode: javaScriptTypeScriptPresentationMode(capability.kind),
    };
  }
  return {
    invalidRawAdmission: false,
    mode: isLargeSmartDocumentContent(content, policy)
      ? "large-non-javascript-typescript"
      : "eligible",
  };
}

function javaScriptTypeScriptPresentationMode(
  kind: "editing-degraded-interactive-lsp" | "editing-only" | "full",
): LargeSmartDocumentPresentationMode {
  return kind === "full" ? "eligible" : kind;
}
