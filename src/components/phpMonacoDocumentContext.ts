import type * as Monaco from "monaco-editor";
import {
  defaultLargeSmartDocumentPolicy,
  isLargeSmartDocument,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  createWorkspaceRoot,
  createWorkspaceRootFromPath,
  parseWorkspacePath,
  type WorkspacePathPolicy,
  type WorkspacePath,
  type WorkspacePathKey,
} from "../domain/workspacePath";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";

type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

const workspacePathsByMonacoUri = new Map<string, WorkspacePath>();
const workspaceIdentityByRootAlias = new Map<
  string,
  { count: number; descriptor: WorkspaceIdentityDescriptor }
>();

export type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";

export function registerWorkspaceIdentityDescriptor(
  descriptor: WorkspaceIdentityDescriptor,
  selectedRoot: string = descriptor.selectedPath ?? descriptor.canonicalRoot,
): () => void {
  const canonicalRoot = descriptor.canonicalRoot ?? selectedRoot;
  const aliases = new Set([
    workspaceRootAliasKey(canonicalRoot, descriptor.policy),
    workspaceRootAliasKey(selectedRoot, descriptor.policy),
  ]);

  for (const alias of aliases) {
    const current = workspaceIdentityByRootAlias.get(alias);
    const entry =
      current?.descriptor === descriptor
        ? { count: current.count + 1, descriptor }
        : { count: 1, descriptor };
    workspaceIdentityByRootAlias.set(alias, entry);
  }

  return () => {
    for (const alias of aliases) {
      const registered = workspaceIdentityByRootAlias.get(alias);

      if (registered?.descriptor !== descriptor) {
        continue;
      }

      if (registered.count === 1) {
        workspaceIdentityByRootAlias.delete(alias);
        continue;
      }

      workspaceIdentityByRootAlias.set(alias, {
        count: registered.count - 1,
        descriptor,
      });
    }
  };
}

function workspaceRootAliasKey(
  rootPath: string,
  policy: WorkspacePathPolicy,
): string {
  const trimmed = rootPath.replace(/\/+$/, "") || "/";
  const segments = trimmed.split("/").map((segment) => {
    const normalized =
      policy.unicodeNormalization === "none"
        ? segment
        : segment.normalize(policy.unicodeNormalization);

    return policy.caseSensitive ? normalized : policy.foldCase(normalized);
  });

  return segments.join("/");
}

export interface PhpMonacoDocumentContextProvider {
  getActiveDocument(): EditorDocument | null;
  getDocumentForModel?(model: MonacoModel): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  getWorkspaceRoot?(): string | null;
}

export interface PhpMonacoDocumentContext {
  activeDocument: EditorDocument;
  path: string;
  rootPath: string;
  sessionId: number | null;
}

export function activePhpDocumentContext(
  context: PhpMonacoDocumentContextProvider,
  model: MonacoModel,
): PhpMonacoDocumentContext | null {
  const activeDocument =
    context.getDocumentForModel?.(model) ?? context.getActiveDocument();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!activeDocument || !rootPath) {
    return null;
  }

  if (activeDocument.language !== "php") {
    return null;
  }

  if (!modelMatchesWorkspacePath(model, rootPath, activeDocument.path)) {
    return null;
  }

  const path = activeDocument.path;

  return {
    activeDocument,
    path,
    rootPath,
    sessionId: runningRuntimeSessionIdForRoot(context, rootPath),
  };
}

export function modelSource(model: MonacoModel, fallbackSource: string): string {
  try {
    return model.getValue();
  } catch {
    return fallbackSource;
  }
}

export function isLargeActivePhpDocument(
  context: PhpMonacoDocumentContextProvider,
  model: MonacoModel,
  policy: LargeSmartDocumentPolicy = defaultLargeSmartDocumentPolicy,
): boolean {
  const documentContext = activePhpDocumentContext(context, model);

  return Boolean(
    documentContext &&
      isLargeSmartDocument(documentContext.activeDocument, policy),
  );
}

/**
 * Converts a 1-based Monaco position into a 0-based character offset into
 * `source`. Lines beyond the source resolve to its end; columns beyond a line
 * clamp to that line's end.
 */
export function offsetAtMonacoPosition(
  source: string,
  position: MonacoPosition,
): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);
  let offset = 0;

  for (let line = 0; line < targetLine && line < lines.length; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  if (targetLine >= lines.length) {
    return source.length;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}

export function isPhpDocumentContextActive(
  context: PhpMonacoDocumentContextProvider,
  request: { rootPath: string; sessionId: number | null },
): boolean {
  return request.sessionId == null
    ? isStoredWorkspaceRootActive(context, request.rootPath)
    : isStoredLanguageServerPayloadActive(
        context,
        request.rootPath,
        request.sessionId,
      );
}

export function isStoredLanguageServerPayloadActive(
  context: PhpMonacoDocumentContextProvider,
  rootPath: string,
  sessionId: number,
): boolean {
  if (!isStoredWorkspaceRootActive(context, rootPath)) {
    return false;
  }

  return runningRuntimeSessionIdForRoot(context, rootPath) === sessionId;
}

export function isStoredWorkspaceRootActive(
  context: Pick<PhpMonacoDocumentContextProvider, "getWorkspaceRoot">,
  rootPath: string,
): boolean {
  const activeRootPath = context.getWorkspaceRoot?.() ?? null;

  return Boolean(activeRootPath && workspaceRootKeysEqual(activeRootPath, rootPath));
}

export function runningRuntimeSessionIdForRoot(
  context: Pick<PhpMonacoDocumentContextProvider, "getRuntimeStatus">,
  rootPath: string,
): number | null {
  const status = context.getRuntimeStatus();

  if (
    status?.kind === "running" &&
    Boolean(status.rootPath) &&
    workspaceRootKeysEqual(status.rootPath, rootPath)
  ) {
    return status.sessionId;
  }

  return null;
}

export function modelPath(model: MonacoModel): string | null {
  const uri = model.uri;

  const workspacePath = workspacePathsByMonacoUri.get(uri.toString());

  if (workspacePath) {
    return workspacePath.nativePath;
  }

  if (uri.scheme && uri.scheme !== "file") {
    return null;
  }

  if (uri.fsPath) {
    return uri.fsPath;
  }

  if (uri.path) {
    return decodeURIComponent(uri.path);
  }

  return null;
}

export function workspacePathForModel(model: MonacoModel): WorkspacePath | null {
  return workspacePathsByMonacoUri.get(model.uri.toString()) ?? null;
}

export function workspacePathKeyForModel(
  model: MonacoModel,
): WorkspacePathKey | null {
  return workspacePathForModel(model)?.key ?? null;
}

export function workspacePathKey(
  rootPath: string,
  path: string,
): WorkspacePathKey | null {
  return resolveWorkspacePath(rootPath, path)?.key ?? null;
}

export function modelMatchesWorkspacePath(
  model: MonacoModel,
  rootPath: string,
  path: string,
): boolean {
  const expectedKey = workspacePathKey(rootPath, path);

  if (!expectedKey) {
    return false;
  }

  const modelKey = workspacePathKeyForModel(model);

  if (modelKey) {
    return modelKey === expectedKey;
  }

  return (
    (!model.uri.scheme || model.uri.scheme === "file") &&
    modelPath(model) === path
  );
}

export function workspaceModelUri(
  rootPath: string,
  path: string,
): string | null {
  const workspacePath = resolveWorkspacePath(rootPath, path);

  if (!workspacePath) {
    return null;
  }

  workspacePathsByMonacoUri.set(workspacePath.monacoUri, workspacePath);
  return workspacePath.monacoUri;
}

/**
 * The workspace id is currently derived from the raw root path. Backend-issued
 * project descriptors will replace this identity source in the integration lane.
 */
function resolveWorkspacePath(
  rootPath: string,
  path: string,
): WorkspacePath | null {
  const descriptor = registeredWorkspaceIdentity(rootPath);
  const root = descriptor
    ? createWorkspaceRoot(
        descriptor.workspaceId,
        descriptor.canonicalRoot,
        descriptor.policy,
      )
    : compatibilityWorkspaceRootFromRawPath(rootPath);

  if (!root.ok) {
    return null;
  }

  const identityPath = descriptor
    ? canonicalPathForWorkspaceAlias(path, descriptor)
    : path;
  const workspacePath = parseWorkspacePath(root.value, identityPath);

  if (!workspacePath.ok) {
    return null;
  }

  return workspacePath.value;
}

function canonicalPathForWorkspaceAlias(
  path: string,
  descriptor: WorkspaceIdentityDescriptor,
): string {
  const relativeSegments = relativeAliasSegments(
    path,
    descriptor.selectedPath,
    descriptor.policy,
  );
  if (!relativeSegments) {
    return path;
  }

  const canonicalRoot = descriptor.canonicalRoot.replace(/\/+$/, "") || "/";
  if (relativeSegments.length === 0) {
    return canonicalRoot;
  }

  return `${canonicalRoot}/${relativeSegments.join("/")}`;
}

function relativeAliasSegments(
  path: string,
  rootPath: string,
  policy: WorkspacePathPolicy,
): string[] | null {
  const pathSegments = path.replace(/\/+$/, "").split("/");
  const rootSegments = rootPath.replace(/\/+$/, "").split("/");
  if (pathSegments.length < rootSegments.length) {
    return null;
  }

  for (let index = 0; index < rootSegments.length; index += 1) {
    const pathSegment = workspaceRootAliasKey(pathSegments[index], policy);
    const rootSegment = workspaceRootAliasKey(rootSegments[index], policy);
    if (pathSegment !== rootSegment) {
      return null;
    }
  }

  return pathSegments.slice(rootSegments.length);
}

function registeredWorkspaceIdentity(
  rootPath: string,
): WorkspaceIdentityDescriptor | null {
  for (const { descriptor } of workspaceIdentityByRootAlias.values()) {
    const alias = workspaceRootAliasKey(rootPath, descriptor.policy);
    const registered = workspaceIdentityByRootAlias.get(alias);

    if (registered?.descriptor === descriptor) {
      return descriptor;
    }
  }

  return null;
}

function compatibilityWorkspaceRootFromRawPath(rootPath: string) {
  return createWorkspaceRootFromPath(rootPath);
}

export function disposeWorkspaceModels(
  monaco: typeof Monaco,
  rootPath: string,
  options: { preserveWorkspaceMappings?: boolean } = {},
): void {
  monaco.editor.getModels().forEach((model) => {
    const workspacePath = workspacePathForModel(model);

    if (!workspacePath) {
      return;
    }

    if (!modelMatchesWorkspacePath(model, rootPath, workspacePath.nativePath)) {
      return;
    }

    if (!options.preserveWorkspaceMappings) {
      workspacePathsByMonacoUri.delete(model.uri.toString());
    }
    model.dispose();
  });

  if (options.preserveWorkspaceMappings) {
    return;
  }

  for (const [uri, workspacePath] of workspacePathsByMonacoUri) {
    const expectedKey = workspacePathKey(rootPath, workspacePath.nativePath);

    if (expectedKey === workspacePath.key) {
      workspacePathsByMonacoUri.delete(uri);
    }
  }
}

export function toWorkspaceMonacoUri(
  monaco: typeof Monaco,
  rootPath: string,
  path: string,
): Monaco.Uri | null {
  const uri = workspaceModelUri(rootPath, path);

  if (!uri) {
    return null;
  }

  if (typeof monaco.Uri.parse !== "function") {
    return monaco.Uri.file(path);
  }

  return monaco.Uri.parse(uri);
}
