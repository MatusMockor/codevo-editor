import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  toLanguageServerTextDocumentPosition,
  type LanguageServerWorkspaceEditEvent,
} from "../../domain/languageServerFeatures";
import { isLanguageServerDocument } from "../../domain/languageServerDocumentSync";
import {
  isLargeSmartDocument,
  type LargeSmartDocumentPolicy,
} from "../../domain/largeDocumentPolicy";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import {
  isLargeActivePhpDocument,
  isStoredLanguageServerPayloadActive,
  modelPath,
  runningRuntimeSessionIdForRoot,
  type PhpMonacoDocumentContext,
  type PhpMonacoDocumentContextProvider,
} from "../phpMonacoDocumentContext";

type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export const INTERACTIVE_FEATURE_REQUEST_TIMEOUT_MS = 2500;
export const HOVER_FEATURE_REQUEST_TIMEOUT_MS = 700;
export const FEATURE_REQUEST_TIMED_OUT = Symbol("featureRequestTimedOut");

export interface LanguageServerMonacoDocumentRequestLease {
  readonly lifecycleIdentity: number;
  readonly path: string;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly syncGeneration: number;
}

export interface ProviderRequestLifecycleContext extends PhpMonacoDocumentContextProvider {
  flushPendingDocumentChange(path: string): Promise<void>;
  getDocumentLifecycleIdentity?(rootPath: string, path: string): number | null;
  getLargeSmartDocumentPolicy?(): LargeSmartDocumentPolicy;
  isDocumentLeaseCurrent?(lease: LanguageServerMonacoDocumentRequestLease): boolean;
  reportError(error: unknown): void;
  requestDocumentLease?(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerMonacoDocumentRequestLease | null>;
}

export type DocumentFeature =
  | "codeAction"
  | "codeLens"
  | "completion"
  | "declaration"
  | "definition"
  | "documentHighlight"
  | "documentSymbol"
  | "documentLink"
  | "foldingRange"
  | "formatting"
  | "hover"
  | "implementation"
  | "inlayHint"
  | "linkedEditingRange"
  | "onTypeFormatting"
  | "prepareRename"
  | "rangeFormatting"
  | "references"
  | "rename"
  | "selectionRange"
  | "semanticTokens"
  | "signatureHelp"
  | "typeDefinition";

export interface ProviderFeatureRequest {
  documentLease?: LanguageServerMonacoDocumentRequestLease | null;
  lifecycleIdentity: number | null;
  path: string;
  rootPath: string;
  sessionId: number;
}

export function featureRequestContext(
  context: ProviderRequestLifecycleContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature: Exclude<
    DocumentFeature,
    | "codeAction"
    | "codeLens"
    | "documentLink"
    | "documentSymbol"
    | "foldingRange"
    | "formatting"
    | "inlayHint"
    | "onTypeFormatting"
    | "rangeFormatting"
    | "selectionRange"
    | "semanticTokens"
  >,
) {
  const request = featureDocumentRequestContext(context, model, feature);

  return request
    ? {
        ...request,
        position: toLanguageServerTextDocumentPosition(request.path, position),
      }
    : null;
}

export function featureDocumentRequestContext(
  context: ProviderRequestLifecycleContext,
  model: MonacoModel,
  feature: DocumentFeature,
): ProviderFeatureRequest | null {
  const activeDocument = context.getActiveDocument();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!activeDocument || !rootPath || !isLanguageServerDocument(activeDocument)) {
    return null;
  }

  const path = modelPath(model);

  if (!path || path !== activeDocument.path) {
    return null;
  }

  if (
    largePhpSmartProviderGuardedFeature(feature) &&
    shouldSkipLargePhpSmartProviders(context, model)
  ) {
    return null;
  }

  const status = runningRuntimeStatusForRoot(context, rootPath);

  if (!status || !canUseLanguageServerFeature(status.capabilities, feature)) {
    return null;
  }

  return {
    lifecycleIdentity: null,
    path,
    rootPath,
    sessionId: status.sessionId,
  };
}

export function shouldSkipLargePhpSmartProviders(
  context: ProviderRequestLifecycleContext,
  model: MonacoModel,
): boolean {
  return isLargeActivePhpDocument(context, model, context.getLargeSmartDocumentPolicy?.());
}

export function isLargePhpDocumentContext(
  context: ProviderRequestLifecycleContext,
  documentContext: PhpMonacoDocumentContext,
): boolean {
  return isLargeSmartDocument(
    documentContext.activeDocument,
    context.getLargeSmartDocumentPolicy?.(),
  );
}

function largePhpSmartProviderGuardedFeature(feature: DocumentFeature): boolean {
  switch (feature) {
    case "codeLens":
    case "completion":
    case "declaration":
    case "definition":
    case "documentLink":
    case "foldingRange":
    case "hover":
    case "implementation":
    case "inlayHint":
    case "references":
    case "semanticTokens":
    case "typeDefinition":
      return true;
    default:
      return false;
  }
}

export function workspaceSymbolRequestContext(context: ProviderRequestLifecycleContext) {
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!rootPath) {
    return null;
  }

  const status = runningRuntimeStatusForRoot(context, rootPath);

  if (!status || !canUseLanguageServerFeature(status.capabilities, "workspaceSymbol")) {
    return null;
  }

  return { rootPath, sessionId: status.sessionId };
}

export async function flushPendingDocumentChangeForActiveRequest(
  context: ProviderRequestLifecycleContext,
  request: ProviderFeatureRequest,
): Promise<boolean> {
  if (context.requestDocumentLease) {
    const lease = await context.requestDocumentLease(request.rootPath, request.path);

    if (!lease || request.sessionId !== lease.sessionId) {
      return false;
    }

    request.documentLease = lease;
    request.lifecycleIdentity = lease.lifecycleIdentity;
    return isFeatureRequestActive(context, request);
  }

  if (context.getDocumentLifecycleIdentity) {
    request.lifecycleIdentity = context.getDocumentLifecycleIdentity(
      request.rootPath,
      request.path,
    );

    if (request.lifecycleIdentity === null) {
      return false;
    }
  }

  await context.flushPendingDocumentChange(request.path);
  return isFeatureRequestActive(context, request);
}

export function runningRuntimeStatusForRoot(
  context: Pick<ProviderRequestLifecycleContext, "getRuntimeStatus">,
  rootPath: string,
): Extract<LanguageServerRuntimeStatus, { kind: "running" }> | null {
  const status = context.getRuntimeStatus();

  return status?.kind === "running" &&
    Boolean(status.rootPath) &&
    workspaceRootKeysEqual(status.rootPath, rootPath)
    ? status
    : null;
}

export function raceInteractiveFeatureRequest<T>(
  request: Promise<T>,
  timeoutMs: number = INTERACTIVE_FEATURE_REQUEST_TIMEOUT_MS,
): Promise<T | typeof FEATURE_REQUEST_TIMED_OUT> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof FEATURE_REQUEST_TIMED_OUT>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(FEATURE_REQUEST_TIMED_OUT), timeoutMs);
  });

  return Promise.race([request, timeout]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

export function isFeatureRequestActive(
  context: ProviderRequestLifecycleContext,
  request: {
    documentLease?: LanguageServerMonacoDocumentRequestLease | null;
    lifecycleIdentity?: number | null;
    path?: string;
    rootPath: string;
    sessionId: number;
  },
): boolean {
  if (request.documentLease && context.isDocumentLeaseCurrent) {
    return context.isDocumentLeaseCurrent(request.documentLease);
  }

  if (!isStoredLanguageServerPayloadActive(context, request.rootPath, request.sessionId)) {
    return false;
  }

  if (request.lifecycleIdentity == null || !request.path) {
    return true;
  }

  return (
    context.getDocumentLifecycleIdentity?.(request.rootPath, request.path) ===
    request.lifecycleIdentity
  );
}

export function isDocumentLifecyclePayloadActive(
  context: ProviderRequestLifecycleContext,
  rootPath: string,
  sessionId: number,
  path: string | undefined,
  lifecycleIdentity: number | undefined,
): boolean {
  if (!context.getDocumentLifecycleIdentity) {
    return isStoredLanguageServerPayloadActive(context, rootPath, sessionId);
  }

  if (!path || lifecycleIdentity == null) {
    return false;
  }

  return isFeatureRequestActive(context, {
    lifecycleIdentity,
    path,
    rootPath,
    sessionId,
  });
}

export function isExecuteCommandPayloadActive(
  context: ProviderRequestLifecycleContext,
  payload: {
    lifecycleIdentity?: number;
    path?: string;
    rootPath: string;
    sessionId: number;
  },
): boolean {
  return payload.lifecycleIdentity == null || !payload.path
    ? isStoredLanguageServerPayloadActive(context, payload.rootPath, payload.sessionId)
    : isDocumentLifecyclePayloadActive(
        context,
        payload.rootPath,
        payload.sessionId,
        payload.path,
        payload.lifecycleIdentity,
      );
}

export function reportErrorForActiveRequest(
  context: ProviderRequestLifecycleContext,
  request: { rootPath: string; sessionId: number },
  error: unknown,
): void {
  if (isFeatureRequestActive(context, request)) {
    context.reportError(error);
  }
}

export function reportErrorForActiveWorkspaceEditEvent(
  context: ProviderRequestLifecycleContext,
  event: LanguageServerWorkspaceEditEvent,
  error: unknown,
): void {
  if (isWorkspaceEditEventActive(context, event)) {
    context.reportError(error);
  }
}

export function isWorkspaceEditEventActive(
  context: ProviderRequestLifecycleContext,
  event: LanguageServerWorkspaceEditEvent,
): boolean {
  const workspaceRoot = context.getWorkspaceRoot?.() ?? null;

  return Boolean(
    workspaceRoot &&
    event.rootPath &&
    workspaceRootKeysEqual(event.rootPath, workspaceRoot) &&
    runningRuntimeSessionIdForRoot(context, event.rootPath) === event.sessionId,
  );
}

export function isPathInWorkspaceRoot(rootPath: string, path: string): boolean {
  const normalizedRootPath = normalizedWorkspacePath(rootPath);
  const normalizedPath = normalizedWorkspacePath(path);

  return (
    normalizedPath === normalizedRootPath || normalizedPath.startsWith(`${normalizedRootPath}/`)
  );
}

function normalizedWorkspacePath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}
