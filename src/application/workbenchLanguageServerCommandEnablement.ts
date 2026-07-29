import {
  canUseLanguageServerFeature,
  type LanguageServerFeature,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export type RunningLanguageServerRuntimeStatus = Extract<
  LanguageServerRuntimeStatus,
  { kind: "running" }
>;

export interface ActiveDocumentLanguage {
  isJavaScriptTypeScriptLanguageServerDocument: boolean;
  isLanguageServerDocument: boolean;
  language: string | null | undefined;
}

export interface ActiveDocumentLanguageServerFeatureOptions {
  activeDocument: ActiveDocumentLanguage | null;
  feature: LanguageServerFeature;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  workspaceRoot: string | null;
}

export type JavaScriptTypeScriptFeatureAvailability =
  | { readonly kind: "notApplicable" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "available";
      supports(feature: LanguageServerFeature): boolean;
    };

/**
 * Presents the active JS/TS runtime as one closed command-availability policy.
 * Non-JS/TS documents remain outside this policy so their Monaco/local-provider
 * command paths keep their existing enablement.
 */
export function javaScriptTypeScriptFeatureAvailability(
  options: Omit<ActiveDocumentLanguageServerFeatureOptions, "feature">,
): JavaScriptTypeScriptFeatureAvailability {
  const {
    activeDocument,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    workspaceRoot,
  } = options;

  if (!activeDocument?.isJavaScriptTypeScriptLanguageServerDocument) {
    return { kind: "notApplicable" };
  }

  if (
    !isRunningLanguageServerForWorkspace(
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      workspaceRoot,
    )
  ) {
    return { kind: "unavailable" };
  }

  const capabilities = javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities;

  return {
    kind: "available",
    supports: (feature) => canUseLanguageServerFeature(capabilities, feature),
  };
}

export function javaScriptTypeScriptCommandSupports(
  availability: JavaScriptTypeScriptFeatureAvailability,
  feature: LanguageServerFeature,
): boolean {
  return availability.kind === "notApplicable"
    ? true
    : availability.kind === "available" && availability.supports(feature);
}

export function canUseActiveDocumentLanguageServerFeature({
  activeDocument,
  feature,
  javaScriptTypeScriptLanguageServerRuntimeStatus,
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  languageServerRuntimeStatus,
  languageServerRuntimeStatusRoot,
  workspaceRoot,
}: ActiveDocumentLanguageServerFeatureOptions): boolean {
  if (!activeDocument) {
    return false;
  }

  if (activeDocument.isJavaScriptTypeScriptLanguageServerDocument) {
    return languageServerRuntimeSupportsFeatureForWorkspace(
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      workspaceRoot,
      feature,
    );
  }

  if (!activeDocument.isLanguageServerDocument) {
    return false;
  }

  return languageServerRuntimeSupportsFeatureForWorkspace(
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    workspaceRoot,
    feature,
  );
}

export function isRunningLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is RunningLanguageServerRuntimeStatus {
  if (!workspaceRoot || !status) {
    return false;
  }

  const rootedStatus = status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return (
    status.kind === "running" &&
    Boolean(rootedStatus) &&
    workspaceRootKeysEqual(rootedStatus, workspaceRoot)
  );
}

function languageServerRuntimeSupportsFeatureForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
  feature: LanguageServerFeature,
): status is RunningLanguageServerRuntimeStatus {
  return (
    isRunningLanguageServerForWorkspace(status, statusRoot, workspaceRoot) &&
    canUseLanguageServerFeature(status.capabilities, feature)
  );
}
