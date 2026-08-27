import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { applyEditorChangeRevert, type EditorChangeHunk } from "../../domain/editorChangeMarkers";
import type {
  EditorSurfaceCommandInvocationScope,
  EditorSurfaceCommandRunner,
} from "../../domain/editorSurfaceCommand";
import {
  isMarkdownDocument,
  markdownPreviewPath,
  type MarkdownPreviewTab,
} from "../../domain/markdownPreview";
import { phpTestClassPlan, renderPhpTestSkeleton } from "../../domain/phpTestGen";
import {
  phpTestNavigationTargets,
  phpTestPartnerMissingMessage,
} from "../../domain/phpTestNavigation";
import type { EditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import {
  getFileName,
  getParentPath,
  createWorkspaceTextFileWithContent,
  joinWorkspacePath,
  visibleEditorPaths,
  workspaceRelativePath,
  type EditorDocument,
  type FileEntry,
  type WorkspaceDescriptor,
  type WorkspaceOwnerFileGateway,
  type WorkspaceWriteResult,
} from "../../domain/workspace";
import {
  openEditorGroupPath,
  type EditorGroupId,
  type EditorGroupsState,
} from "../../domain/editorGroups";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import {
  editorGroupDocumentSessionWorkspaceMatches,
  type EditorGroupDocumentSessionAuthority,
  type EditorSessionDocumentLifecycleAuthority,
} from "../editorSessionDocumentAuthority";
import { isSessionPathInWorkspace } from "../documentSessionState";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import { useWorkbenchActiveDocumentEditing } from "../useWorkbenchActiveDocumentEditing";
import { useWorkbenchCommandContext } from "../useWorkbenchCommandContext";
import { usePhpCodeActionNewFileApplication } from "../usePhpCodeActionNewFileApplication";
import { useWorkbenchNavigation } from "../useWorkbenchNavigation";

type ActiveEditingDependencies = Parameters<typeof useWorkbenchActiveDocumentEditing>[0];
type CommandContextDependencies = Parameters<typeof useWorkbenchCommandContext>[0];
type NavigationDependencies = Parameters<typeof useWorkbenchNavigation>[0];
type PhpCodeActionDependencies = Parameters<typeof usePhpCodeActionNewFileApplication>[0];
type WorkbenchNavigation = ReturnType<typeof useWorkbenchNavigation>;

interface WorkbenchEditorAuthorityDependencies {
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly isDocumentSessionLifecycleAuthorityCurrent: (
    authority: EditorSessionDocumentLifecycleAuthority,
  ) => boolean;
  readonly isEditorGroupDocumentSessionAuthorityCurrent: (
    authority: EditorGroupDocumentSessionAuthority,
  ) => boolean;
  readonly resolveActiveDocumentSessionAuthority: () => EditorGroupDocumentSessionAuthority | null;
  readonly resolveDocumentSessionLifecycleAuthority: (
    path: string,
  ) => EditorSessionDocumentLifecycleAuthority | null;
  readonly workspaceIdentityDescriptorRef: MutableRefObject<WorkspaceIdentityDescriptor | null>;
  readonly workspaceRuntimeOwnerClaimsRef: {
    readonly current: { generationFor(ownerKey: string): number | null | undefined };
  };
  readonly workspaceRuntimeOwnerRef: MutableRefObject<WorkspaceRuntimeOwner | null>;
}

interface MarkdownDependencies {
  readonly documents: Readonly<Record<string, EditorDocument>>;
  readonly documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  readonly markdownPreviewRenderer: (markdown: string) => Promise<string>;
  readonly markdownPreviewTabsRef: MutableRefObject<Record<string, MarkdownPreviewTab>>;
  readonly openMarkdownPreviews: readonly MarkdownPreviewTab[];
  readonly openPathsRef: MutableRefObject<string[]>;
  readonly previewPathRef: MutableRefObject<string | null>;
  readonly reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  readonly setActivePath: Dispatch<SetStateAction<string | null>>;
  readonly setMarkdownPreviewTabs: Dispatch<SetStateAction<Record<string, MarkdownPreviewTab>>>;
  readonly updateEditorGroups: (update: (current: EditorGroupsState) => EditorGroupsState) => void;
  readonly workspaceRoot: string | null;
}

interface TestNavigationDependencies {
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly notifyJavaScriptTypeScriptWatchedFilesChanged: (
    changes: { readonly changeType: "created"; readonly path: string }[],
  ) => Promise<void>;
  readonly openFile: (
    entry: FileEntry,
    options?: { readonly shouldCommit?: () => boolean },
  ) => Promise<boolean>;
  readonly readTestFileIfExists: (path: string) => Promise<string | null>;
  readonly refreshDirectory: (path: string) => Promise<void>;
  readonly reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  readonly setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
  readonly workspaceOwnerFiles: WorkspaceOwnerFileGateway | undefined;
  readonly workspaceRoot: string | null;
  readonly workspaceFiles: PhpCodeActionDependencies["workspaceFiles"];
}

interface NavigationScopeDependencies {
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly activeGroupId: EditorGroupId;
  readonly activePath: string | null;
  readonly currentEditorSessionOwnerKeyRef: MutableRefObject<EditorSessionOwnerKey | null>;
  readonly editorSessionOwnerKey: EditorSessionOwnerKey | null;
  readonly editorSurfaceCommandRunner: EditorSurfaceCommandRunner | null | undefined;
}

export interface WorkbenchEditorDocumentCoordinatorDependencies {
  readonly activeEditing: ActiveEditingDependencies;
  readonly authority: WorkbenchEditorAuthorityDependencies;
  readonly commandContext: Omit<CommandContextDependencies, "captureEditorSurfaceScope">;
  readonly markdown: MarkdownDependencies;
  readonly navigation: Omit<NavigationDependencies, "commandContextRef">;
  readonly navigationScope: NavigationScopeDependencies;
  readonly openSymbolPanelNavigationTargetRef: MutableRefObject<
    WorkbenchNavigation["openNavigationTarget"]
  >;
  readonly phpCodeAction: PhpCodeActionDependencies;
  readonly testNavigation: TestNavigationDependencies;
}

export interface WorkbenchEditorDocumentCoordinator {
  readonly activateSearchEverywhereItem: WorkbenchNavigation["activateSearchEverywhereItem"];
  readonly applyPhpCodeActionNewFile: ReturnType<typeof usePhpCodeActionNewFileApplication>;
  readonly commandContext: ReturnType<typeof useWorkbenchCommandContext>["commandContext"];
  readonly commandContextRef: ReturnType<typeof useWorkbenchCommandContext>["commandContextRef"];
  readonly captureNavigationCommandScope: () => EditorSurfaceCommandInvocationScope;
  readonly generateTestForActiveDocument: () => Promise<void>;
  readonly goToNextProblem: WorkbenchNavigation["goToNextProblem"];
  readonly goToPreviousProblem: WorkbenchNavigation["goToPreviousProblem"];
  readonly goToTestForActiveDocument: () => Promise<void>;
  readonly openClassSearchResult: WorkbenchNavigation["openClassSearchResult"];
  readonly openCurrentFileLocation: WorkbenchNavigation["openCurrentFileLocation"];
  readonly openMarkdownPreview: () => Promise<void>;
  readonly openNavigationTarget: WorkbenchNavigation["openNavigationTarget"];
  readonly openPathForNavigation: WorkbenchNavigation["openPathForNavigation"];
  readonly openProblemNotice: WorkbenchNavigation["openProblemNotice"];
  readonly openRecentFile: WorkbenchNavigation["openRecentFile"];
  readonly openSearchResult: WorkbenchNavigation["openSearchResult"];
  readonly openWorkspaceSymbolResult: WorkbenchNavigation["openWorkspaceSymbolResult"];
  readonly isNavigationCommandScopeCurrent: (scope: EditorSurfaceCommandInvocationScope) => boolean;
  readonly navigationSurfaceIdentity: object;
  readonly readNavigationFileContent: WorkbenchNavigation["readNavigationFileContent"];
  readonly revertActiveEditorChangeHunk: (hunk: EditorChangeHunk) => void;
  readonly updateActiveDocument: ReturnType<typeof useWorkbenchActiveDocumentEditing>;
}

export interface WorkbenchEditorDocumentAuthority {
  readonly document: EditorDocument;
  readonly documentAuthority: EditorGroupDocumentSessionAuthority;
  readonly identity: WorkspaceIdentityDescriptor;
  readonly owner: WorkspaceRuntimeOwner;
  readonly ownerGeneration: number;
  readonly rootPath: string;
  isCurrent(): boolean;
}

type FallbackNavigationAuthority =
  | {
      readonly kind: "documentSession";
      readonly authority: EditorGroupDocumentSessionAuthority;
    }
  | {
      readonly kind: "legacyDocument";
      readonly document: EditorDocument | null;
      readonly owner: WorkspaceRuntimeOwner | null;
      readonly ownerGeneration: null | undefined;
      readonly rootPath: string | null;
    };

const fallbackNavigationAuthorities = new WeakMap<
  EditorSurfaceCommandInvocationScope,
  FallbackNavigationAuthority
>();

export function captureWorkbenchFallbackNavigationScope(
  authority: WorkbenchEditorAuthorityDependencies,
  navigationScope: NavigationScopeDependencies,
  navigationSurfaceIdentity: object,
): EditorSurfaceCommandInvocationScope {
  const documentAuthority = authority.resolveActiveDocumentSessionAuthority();
  const scope: EditorSurfaceCommandInvocationScope = {
    documentPath:
      documentAuthority?.path ?? navigationScope.activeDocumentRef.current?.path ?? null,
    modelIdentity: documentAuthority?.identity ?? null,
    ownerKey: navigationScope.currentEditorSessionOwnerKeyRef.current,
    surfaceIdentity: navigationSurfaceIdentity,
  };
  if (documentAuthority) {
    fallbackNavigationAuthorities.set(scope, {
      authority: documentAuthority,
      kind: "documentSession",
    });
  }
  const legacyRoot = authority.currentWorkspaceRootRef.current;
  const legacyOwner = authority.workspaceRuntimeOwnerRef.current;
  const legacyOwnerGeneration = legacyOwner
    ? authority.workspaceRuntimeOwnerClaimsRef.current.generationFor(legacyOwner.ownerKey)
    : null;
  const legacyOwnerIsValid =
    !legacyOwner ||
    (legacyRoot !== null &&
      legacyOwner.ownerKey === normalizedWorkspaceRootKey(legacyRoot) &&
      workspaceRootKeysEqual(legacyOwner.executionRoot, legacyRoot));
  if (
    !documentAuthority &&
    !authority.workspaceIdentityDescriptorRef.current &&
    legacyOwnerIsValid &&
    (legacyOwnerGeneration === null || legacyOwnerGeneration === undefined)
  ) {
    fallbackNavigationAuthorities.set(scope, {
      document: navigationScope.activeDocumentRef.current,
      kind: "legacyDocument",
      owner: legacyOwner,
      ownerGeneration: legacyOwnerGeneration,
      rootPath: legacyRoot,
    });
  }
  return scope;
}

export function isWorkbenchFallbackNavigationScopeCurrent(
  authority: WorkbenchEditorAuthorityDependencies,
  navigationScope: NavigationScopeDependencies,
  navigationSurfaceIdentity: object,
  scope: EditorSurfaceCommandInvocationScope,
): boolean | null {
  const fallbackAuthority = fallbackNavigationAuthorities.get(scope);
  if (!fallbackAuthority) {
    return null;
  }
  switch (fallbackAuthority.kind) {
    case "documentSession":
      return (
        scope.surfaceIdentity === navigationSurfaceIdentity &&
        scope.modelIdentity === fallbackAuthority.authority.identity &&
        authority.isEditorGroupDocumentSessionAuthorityCurrent(fallbackAuthority.authority)
      );
    case "legacyDocument":
      return (
        !authority.workspaceIdentityDescriptorRef.current &&
        workspaceRootKeysEqual(
          authority.currentWorkspaceRootRef.current,
          fallbackAuthority.rootPath,
        ) &&
        authority.workspaceRuntimeOwnerRef.current === fallbackAuthority.owner &&
        (!fallbackAuthority.owner ||
          authority.workspaceRuntimeOwnerClaimsRef.current.generationFor(
            fallbackAuthority.owner.ownerKey,
          ) === fallbackAuthority.ownerGeneration) &&
        navigationScope.activeDocumentRef.current === fallbackAuthority.document &&
        scope.surfaceIdentity === navigationSurfaceIdentity
      );
    default: {
      const unsupported: never = fallbackAuthority;
      return unsupported;
    }
  }
}

interface FacetCacheEntry<Value extends object> {
  readonly value: Value;
}

function retainStableFacet<Value extends object>(
  cache: WeakMap<object, FacetCacheEntry<Value>>,
  key: object,
  next: Value,
): Value {
  const current = cache.get(key)?.value;
  if (current) {
    const keys = Object.keys(next) as (keyof Value)[];
    if (
      keys.length === Object.keys(current).length &&
      keys.every((property) => current[property] === next[property])
    ) {
      return current;
    }
  }
  cache.set(key, { value: next });
  return next;
}

const authorityFacetCache = new WeakMap<
  object,
  FacetCacheEntry<WorkbenchEditorAuthorityDependencies>
>();
const markdownFacetCache = new WeakMap<object, FacetCacheEntry<MarkdownDependencies>>();
const navigationScopeFacetCache = new WeakMap<
  object,
  FacetCacheEntry<NavigationScopeDependencies>
>();
const testNavigationFacetCache = new WeakMap<object, FacetCacheEntry<TestNavigationDependencies>>();

interface EditorDocumentAuthorityCacheEntry {
  readonly authority: WorkbenchEditorDocumentAuthority;
  readonly dependencies: WorkbenchEditorAuthorityDependencies;
  readonly document: EditorDocument;
  readonly identity: WorkspaceIdentityDescriptor;
  readonly owner: WorkspaceRuntimeOwner;
  readonly ownerGeneration: number;
  readonly rootPath: string;
}

const editorDocumentAuthorityCache = new WeakMap<
  EditorGroupDocumentSessionAuthority,
  EditorDocumentAuthorityCacheEntry
>();

interface LegacyActiveDocumentCurrentCacheEntry {
  readonly current: (() => boolean) | null;
  readonly dependencies: WorkbenchEditorAuthorityDependencies;
  readonly identity: WorkspaceIdentityDescriptor | null;
  readonly lifecycleAuthority: EditorSessionDocumentLifecycleAuthority | null;
  readonly owner: WorkspaceRuntimeOwner | null;
  readonly ownerGeneration: number | null | undefined;
  readonly rootPath: string | null;
}

const legacyActiveDocumentCurrentCache = new WeakMap<
  EditorDocument,
  LegacyActiveDocumentCurrentCacheEntry
>();

export function captureStableLegacyActiveDocumentCurrent(
  dependencies: WorkbenchEditorAuthorityDependencies,
  rootPath: string | null,
  document: EditorDocument | null,
): (() => boolean) | null {
  if (!document) {
    return null;
  }
  const owner = dependencies.workspaceRuntimeOwnerRef.current;
  const identity = dependencies.workspaceIdentityDescriptorRef.current;
  const ownerGeneration = owner
    ? dependencies.workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey)
    : null;
  const lifecycleAuthority = dependencies.resolveDocumentSessionLifecycleAuthority(document.path);
  const cached = legacyActiveDocumentCurrentCache.get(document);
  if (
    cached?.dependencies === dependencies &&
    cached.identity === identity &&
    cached.rootPath === rootPath &&
    cached.owner === owner &&
    cached.ownerGeneration === ownerGeneration &&
    cached.lifecycleAuthority === lifecycleAuthority
  ) {
    return cached.current;
  }
  const current = captureWorkbenchDocumentLifecycleCurrent(
    dependencies,
    rootPath,
    document,
    () => dependencies.activeDocumentRef.current === document,
  );
  legacyActiveDocumentCurrentCache.set(document, {
    current,
    dependencies,
    identity,
    lifecycleAuthority,
    owner,
    ownerGeneration,
    rootPath,
  });
  return current;
}

export function captureWorkbenchDocumentLifecycleCurrent(
  dependencies: WorkbenchEditorAuthorityDependencies,
  rootPath: string | null,
  document: EditorDocument | null,
  documentIsCurrent: () => boolean,
): (() => boolean) | null {
  if (!rootPath || !document) {
    return null;
  }
  const identity = dependencies.workspaceIdentityDescriptorRef.current;
  const owner = dependencies.workspaceRuntimeOwnerRef.current;
  const lifecycleAuthority = dependencies.resolveDocumentSessionLifecycleAuthority(document.path);
  const legacyOwner =
    !identity &&
    owner !== null &&
    owner.ownerKey === normalizedWorkspaceRootKey(rootPath) &&
    workspaceRootKeysEqual(owner.executionRoot, rootPath)
      ? owner
      : null;
  if (!identity && (!owner || legacyOwner)) {
    const legacyGeneration = legacyOwner
      ? dependencies.workspaceRuntimeOwnerClaimsRef.current.generationFor(legacyOwner.ownerKey)
      : null;
    if (legacyGeneration !== null && legacyGeneration !== undefined) {
      return null;
    }
    return () =>
      workspaceRootKeysEqual(dependencies.currentWorkspaceRootRef.current, rootPath) &&
      (!legacyOwner ||
        (dependencies.workspaceRuntimeOwnerRef.current === legacyOwner &&
          dependencies.workspaceRuntimeOwnerClaimsRef.current.generationFor(
            legacyOwner.ownerKey,
          ) === legacyGeneration)) &&
      documentIsCurrent() &&
      (!lifecycleAuthority ||
        dependencies.isDocumentSessionLifecycleAuthorityCurrent(lifecycleAuthority));
  }
  if (!identity || !owner || !lifecycleAuthority || identity.workspaceId !== owner.ownerKey) {
    return null;
  }
  const ownerGeneration = dependencies.workspaceRuntimeOwnerClaimsRef.current.generationFor(
    owner.ownerKey,
  );
  if (ownerGeneration === null || ownerGeneration === undefined) {
    return null;
  }
  return () =>
    dependencies.workspaceIdentityDescriptorRef.current === identity &&
    dependencies.workspaceRuntimeOwnerRef.current === owner &&
    dependencies.workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey) ===
      ownerGeneration &&
    workspaceRootKeysEqual(dependencies.currentWorkspaceRootRef.current, rootPath) &&
    workspaceRootKeysEqual(owner.executionRoot, rootPath) &&
    dependencies.isDocumentSessionLifecycleAuthorityCurrent(lifecycleAuthority) &&
    documentIsCurrent();
}

export function captureWorkbenchEditorDocumentAuthority(
  dependencies: WorkbenchEditorAuthorityDependencies,
  rootPath: string | null,
  document: EditorDocument | null,
): WorkbenchEditorDocumentAuthority | null {
  const identity = dependencies.workspaceIdentityDescriptorRef.current;
  const owner = dependencies.workspaceRuntimeOwnerRef.current;
  const documentAuthority = dependencies.resolveActiveDocumentSessionAuthority();
  if (!rootPath || !document || !identity || !owner || !documentAuthority) {
    return null;
  }
  const ownerGeneration = dependencies.workspaceRuntimeOwnerClaimsRef.current.generationFor(
    owner.ownerKey,
  );
  if (ownerGeneration === null || ownerGeneration === undefined) {
    return null;
  }
  if (
    identity.workspaceId !== owner.ownerKey ||
    !workspaceRootKeysEqual(owner.executionRoot, rootPath) ||
    !editorGroupDocumentSessionWorkspaceMatches(documentAuthority, rootPath) ||
    documentAuthority.path !== document.path ||
    dependencies.activeDocumentRef.current !== document
  ) {
    return null;
  }
  const isCurrent = () =>
    dependencies.currentWorkspaceRootRef.current !== null &&
    workspaceRootKeysEqual(dependencies.currentWorkspaceRootRef.current, rootPath) &&
    dependencies.workspaceIdentityDescriptorRef.current === identity &&
    dependencies.workspaceRuntimeOwnerRef.current === owner &&
    dependencies.workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey) ===
      ownerGeneration &&
    dependencies.activeDocumentRef.current === document &&
    dependencies.isEditorGroupDocumentSessionAuthorityCurrent(documentAuthority) &&
    editorGroupDocumentSessionWorkspaceMatches(documentAuthority, rootPath);
  const cached = editorDocumentAuthorityCache.get(documentAuthority);
  if (
    cached?.document === document &&
    cached.dependencies === dependencies &&
    cached.identity === identity &&
    cached.owner === owner &&
    cached.ownerGeneration === ownerGeneration &&
    cached.rootPath === rootPath
  ) {
    return cached.authority;
  }
  const captured = Object.freeze({
    document,
    documentAuthority,
    identity,
    isCurrent,
    owner,
    ownerGeneration,
    rootPath,
  });
  editorDocumentAuthorityCache.set(documentAuthority, {
    authority: captured,
    dependencies,
    document,
    identity,
    owner,
    ownerGeneration,
    rootPath,
  });
  return captured;
}

function workspaceWriteSucceeded(
  result: WorkspaceWriteResult,
): result is Extract<WorkspaceWriteResult, { readonly status: "success" }> {
  switch (result.status) {
    case "success":
      return true;
    case "conflict":
    case "partial":
    case "error":
      return false;
    default: {
      const unsupported: never = result;
      return unsupported;
    }
  }
}

export function useWorkbenchEditorDocumentCoordinator({
  activeEditing,
  authority,
  commandContext: commandContextDependencies,
  markdown,
  navigation,
  navigationScope,
  openSymbolPanelNavigationTargetRef,
  phpCodeAction,
  testNavigation,
}: WorkbenchEditorDocumentCoordinatorDependencies): WorkbenchEditorDocumentCoordinator {
  authority = retainStableFacet(authorityFacetCache, authority.activeDocumentRef, authority);
  markdown = retainStableFacet(markdownFacetCache, markdown.markdownPreviewTabsRef, markdown);
  navigationScope = retainStableFacet(
    navigationScopeFacetCache,
    navigationScope.currentEditorSessionOwnerKeyRef,
    navigationScope,
  );
  testNavigation = retainStableFacet(
    testNavigationFacetCache,
    testNavigation.activeDocumentRef,
    testNavigation,
  );
  const rawUpdateActiveDocument = useWorkbenchActiveDocumentEditing(activeEditing);
  const activeEditAuthority = captureWorkbenchEditorDocumentAuthority(
    authority,
    testNavigation.workspaceRoot,
    authority.activeDocumentRef.current,
  );
  const legacyActiveEditIsCurrent = activeEditAuthority
    ? null
    : captureStableLegacyActiveDocumentCurrent(
        authority,
        testNavigation.workspaceRoot,
        activeEditing.activeDocument,
      );

  const openMarkdownPreview = useCallback(async () => {
    const source = authority.activeDocumentRef.current;
    const requestedRoot = authority.currentWorkspaceRootRef.current;
    if (!requestedRoot || !isMarkdownDocument(source)) {
      return;
    }
    if (!isSessionPathInWorkspace(requestedRoot, source.path)) {
      return;
    }
    const isCurrent = captureWorkbenchDocumentLifecycleCurrent(
      authority,
      requestedRoot,
      source,
      () => markdown.documentsRef.current[source.path] === source,
    );
    if (!isCurrent?.()) {
      return;
    }
    const path = markdownPreviewPath(source.path);
    const existing = markdown.markdownPreviewTabsRef.current[path];
    if (existing) {
      markdown.setActivePath(path);
      return;
    }
    const preview: MarkdownPreviewTab = {
      content: source.content,
      html: "",
      name: `${source.name} Preview`,
      path,
      sourcePath: source.path,
    };
    const nextMarkdownPreviews = {
      ...markdown.markdownPreviewTabsRef.current,
      [path]: preview,
    };
    const nextOpenPaths = [
      ...new Set([
        ...visibleEditorPaths(markdown.openPathsRef.current, markdown.previewPathRef.current),
        source.path,
        path,
      ]),
    ];
    markdown.markdownPreviewTabsRef.current = nextMarkdownPreviews;
    markdown.openPathsRef.current = nextOpenPaths;
    markdown.previewPathRef.current = null;
    authority.activeDocumentRef.current = null;
    markdown.setMarkdownPreviewTabs(nextMarkdownPreviews);
    markdown.updateEditorGroups((current) => ({
      ...current,
      groups: {
        ...current.groups,
        [current.activeGroupId]: openEditorGroupPath(current.groups[current.activeGroupId], {
          nextActivePath: path,
          nextOpenPaths,
          nextPreviewPath: null,
        }),
      },
    }));
    try {
      const html = await markdown.markdownPreviewRenderer(source.content);
      if (!isCurrent()) {
        return;
      }
      const current = markdown.markdownPreviewTabsRef.current[path];
      if (!current || current.sourcePath !== source.path) {
        return;
      }
      const renderedPreviews = {
        ...markdown.markdownPreviewTabsRef.current,
        [path]: { ...current, html },
      };
      if (!isCurrent()) {
        return;
      }
      markdown.markdownPreviewTabsRef.current = renderedPreviews;
      markdown.setMarkdownPreviewTabs(renderedPreviews);
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      markdown.reportErrorForActiveWorkspaceRoot(requestedRoot, "Markdown Preview", error);
    }
  }, [authority, markdown]);

  useEffect(() => {
    if (!markdown.workspaceRoot) {
      return;
    }
    const timeoutIds: number[] = [];
    markdown.openMarkdownPreviews.forEach((preview) => {
      const source = markdown.documents[preview.sourcePath];
      if (!source || source.content === preview.content) {
        return;
      }
      const requestedRoot = markdown.workspaceRoot;
      const content = source.content;
      const isCurrent = captureWorkbenchDocumentLifecycleCurrent(
        authority,
        requestedRoot,
        source,
        () => markdown.documentsRef.current[source.path] === source,
      );
      if (!isCurrent) {
        return;
      }
      const timeoutId = window.setTimeout(() => {
        if (!isCurrent()) {
          return;
        }
        void markdown.markdownPreviewRenderer(content).then(
          (html) => {
            if (!isCurrent()) {
              return;
            }
            const current = markdown.markdownPreviewTabsRef.current[preview.path];
            if (
              !current ||
              current.sourcePath !== preview.sourcePath ||
              !markdown.openPathsRef.current.includes(preview.path)
            ) {
              return;
            }
            const renderedPreviews = {
              ...markdown.markdownPreviewTabsRef.current,
              [preview.path]: { ...current, content, html },
            };
            if (!isCurrent()) {
              return;
            }
            markdown.markdownPreviewTabsRef.current = renderedPreviews;
            markdown.setMarkdownPreviewTabs(renderedPreviews);
          },
          (error: unknown) => {
            if (!isCurrent()) {
              return;
            }
            markdown.reportErrorForActiveWorkspaceRoot(requestedRoot, "Markdown Preview", error);
          },
        );
      }, 300);
      timeoutIds.push(timeoutId);
    });
    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [authority, markdown]);

  const revertActiveEditorChangeHunk = useCallback(
    (hunk: EditorChangeHunk) => {
      const isCurrent = activeEditAuthority?.isCurrent ?? legacyActiveEditIsCurrent;
      if (!isCurrent?.()) {
        return;
      }
      const document = activeEditAuthority?.document ?? activeEditing.activeDocument;
      if (!document) {
        return;
      }
      const content = applyEditorChangeRevert(document.content, hunk);
      if (content === document.content || !isCurrent()) {
        return;
      }
      rawUpdateActiveDocument(content);
    },
    [
      activeEditAuthority,
      activeEditing.activeDocument,
      legacyActiveEditIsCurrent,
      rawUpdateActiveDocument,
    ],
  );

  const generateTestForActiveDocument = useCallback(async () => {
    const requestedDocument = testNavigation.activeDocumentRef.current;
    const requestedDescriptor = testNavigation.workspaceDescriptor;
    const registeredAuthority = captureWorkbenchEditorDocumentAuthority(
      authority,
      testNavigation.workspaceRoot,
      requestedDocument,
    );
    const legacyRoot = testNavigation.workspaceRoot;
    const legacyCurrent = !authority.workspaceIdentityDescriptorRef.current
      ? captureWorkbenchDocumentLifecycleCurrent(
          authority,
          legacyRoot,
          requestedDocument,
          () => testNavigation.activeDocumentRef.current === requestedDocument,
        )
      : null;
    const isCurrent = registeredAuthority?.isCurrent ?? legacyCurrent ?? (() => false);
    if (
      !requestedDocument ||
      !requestedDescriptor?.php ||
      requestedDocument.language !== "php" ||
      (!registeredAuthority && !legacyCurrent?.())
    ) {
      return;
    }
    const plan = phpTestClassPlan({
      psr4Roots: requestedDescriptor.php.psr4Roots,
      source: requestedDocument.content,
    });
    if (!plan) {
      if (isCurrent()) {
        testNavigation.setMessage("Generate test: no testable class in the active file.");
      }
      return;
    }
    const requestedRoot = registeredAuthority?.rootPath ?? legacyRoot;
    if (!requestedRoot) {
      return;
    }
    const testPath = joinWorkspacePath(requestedRoot, plan.relativePath);
    try {
      const existingTest = await testNavigation.readTestFileIfExists(testPath);
      if (!isCurrent()) {
        return;
      }
      if (existingTest !== null) {
        await testNavigation.openFile(
          { kind: "file", name: getFileName(testPath), path: testPath },
          { shouldCommit: isCurrent },
        );
        if (!isCurrent()) {
          return;
        }
        return;
      }
      const parentPath = getParentPath(testPath);
      if (registeredAuthority) {
        if (!testNavigation.workspaceOwnerFiles || !registeredAuthority.isCurrent()) {
          return;
        }
        await testNavigation.workspaceOwnerFiles.createDirectoryForWorkspace(
          registeredAuthority.identity.workspaceId,
          parentPath,
        );
        if (!registeredAuthority.isCurrent()) {
          return;
        }
        const result =
          await testNavigation.workspaceOwnerFiles.createTextFileWithContentForWorkspace(
            registeredAuthority.identity.workspaceId,
            testPath,
            renderPhpTestSkeleton(plan),
          );
        if (!registeredAuthority.isCurrent()) {
          return;
        }
        if (!workspaceWriteSucceeded(result)) {
          testNavigation.reportErrorForActiveWorkspaceRoot(
            requestedRoot,
            "Generate Test",
            new Error(result.message),
          );
          return;
        }
      }
      if (!registeredAuthority) {
        await testNavigation.workspaceFiles.createDirectory(parentPath);
        if (!isCurrent()) {
          return;
        }
        await createWorkspaceTextFileWithContent(
          testNavigation.workspaceFiles,
          testPath,
          renderPhpTestSkeleton(plan),
        );
        if (!isCurrent()) {
          return;
        }
      }
      await testNavigation.notifyJavaScriptTypeScriptWatchedFilesChanged([
        { changeType: "created", path: testPath },
      ]);
      if (!isCurrent()) {
        return;
      }
      testNavigation.setExpandedDirectories((current) => new Set(current).add(parentPath));
      await testNavigation.refreshDirectory(parentPath);
      if (!isCurrent()) {
        return;
      }
      await testNavigation.openFile(
        { kind: "file", name: getFileName(testPath), path: testPath },
        { shouldCommit: isCurrent },
      );
      if (!isCurrent()) {
        return;
      }
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      testNavigation.reportErrorForActiveWorkspaceRoot(requestedRoot, "Generate Test", error);
    }
  }, [authority, testNavigation]);

  const applyPhpCodeActionNewFile = usePhpCodeActionNewFileApplication(phpCodeAction);

  const goToTestForActiveDocument = useCallback(async () => {
    const requestedDocument = testNavigation.activeDocumentRef.current;
    const requestedDescriptor = testNavigation.workspaceDescriptor;
    const requestedAuthority = captureWorkbenchEditorDocumentAuthority(
      authority,
      testNavigation.workspaceRoot,
      requestedDocument,
    );
    const legacyCurrent = !authority.workspaceIdentityDescriptorRef.current
      ? captureWorkbenchDocumentLifecycleCurrent(
          authority,
          testNavigation.workspaceRoot,
          requestedDocument,
          () => testNavigation.activeDocumentRef.current === requestedDocument,
        )
      : null;
    const isCurrent = requestedAuthority?.isCurrent ?? legacyCurrent ?? (() => false);
    if (
      (!requestedAuthority && !legacyCurrent?.()) ||
      !requestedDescriptor?.php ||
      requestedDocument?.language !== "php"
    ) {
      return;
    }
    const requestedRoot = requestedAuthority?.rootPath ?? testNavigation.workspaceRoot;
    if (!requestedRoot) {
      return;
    }
    const relativePath = workspaceRelativePath(requestedRoot, requestedDocument.path);
    if (!relativePath) {
      return;
    }
    const navigationPlan = phpTestNavigationTargets({
      psr4Roots: requestedDescriptor.php.psr4Roots,
      relativePath,
    });
    if (!navigationPlan) {
      if (isCurrent()) {
        testNavigation.setMessage("Go to test: no test mapping for the active file.");
      }
      return;
    }
    try {
      for (const candidate of navigationPlan.candidates) {
        const candidatePath = joinWorkspacePath(requestedRoot, candidate);
        const existing = await testNavigation.readTestFileIfExists(candidatePath);
        if (!isCurrent()) {
          return;
        }
        if (existing === null) {
          continue;
        }
        await testNavigation.openFile(
          { kind: "file", name: getFileName(candidatePath), path: candidatePath },
          { shouldCommit: isCurrent },
        );
        if (!isCurrent()) {
          return;
        }
        return;
      }
      if (isCurrent()) {
        testNavigation.setMessage(phpTestPartnerMissingMessage(navigationPlan.direction));
      }
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      testNavigation.reportErrorForActiveWorkspaceRoot(requestedRoot, "Go to Test", error);
    }
  }, [authority, testNavigation]);

  const navigationRuntimeOwner = authority.workspaceRuntimeOwnerRef.current;
  const navigationRuntimeOwnerGeneration = navigationRuntimeOwner
    ? authority.workspaceRuntimeOwnerClaimsRef.current.generationFor(
        navigationRuntimeOwner.ownerKey,
      )
    : null;
  const navigationSurfaceIdentity = useMemo(
    () => ({
      activeGroupId: navigationScope.activeGroupId,
      activePath: navigationScope.activePath,
      editorSessionOwnerKey: navigationScope.editorSessionOwnerKey,
      navigationRuntimeOwner,
      navigationRuntimeOwnerGeneration,
    }),
    [
      navigationScope.activeGroupId,
      navigationScope.activePath,
      navigationScope.editorSessionOwnerKey,
      navigationRuntimeOwner,
      navigationRuntimeOwnerGeneration,
    ],
  );
  const captureNavigationCommandScope = useCallback((): EditorSurfaceCommandInvocationScope => {
    const runnerScope = navigationScope.editorSurfaceCommandRunner?.captureScope?.();
    if (runnerScope) {
      return runnerScope;
    }
    return captureWorkbenchFallbackNavigationScope(
      authority,
      navigationScope,
      navigationSurfaceIdentity,
    );
  }, [authority, navigationScope, navigationSurfaceIdentity]);
  const isNavigationCommandScopeCurrent = useCallback(
    (scope: EditorSurfaceCommandInvocationScope) => {
      if (scope.ownerKey !== navigationScope.currentEditorSessionOwnerKeyRef.current) {
        return false;
      }
      if (scope.documentPath !== (navigationScope.activeDocumentRef.current?.path ?? null)) {
        return false;
      }
      const fallbackCurrent = isWorkbenchFallbackNavigationScopeCurrent(
        authority,
        navigationScope,
        navigationSurfaceIdentity,
        scope,
      );
      if (fallbackCurrent !== null) {
        return fallbackCurrent;
      }
      return navigationScope.editorSurfaceCommandRunner?.isScopeCurrent?.(scope) ?? false;
    },
    [authority, navigationScope, navigationSurfaceIdentity],
  );
  const { commandContext, commandContextRef } = useWorkbenchCommandContext({
    ...commandContextDependencies,
    captureEditorSurfaceScope: captureNavigationCommandScope,
  });

  const workbenchNavigation = useWorkbenchNavigation({ ...navigation, commandContextRef });
  openSymbolPanelNavigationTargetRef.current = workbenchNavigation.openNavigationTarget;

  return {
    ...workbenchNavigation,
    applyPhpCodeActionNewFile,
    captureNavigationCommandScope,
    commandContext,
    commandContextRef,
    generateTestForActiveDocument,
    goToTestForActiveDocument,
    isNavigationCommandScopeCurrent,
    navigationSurfaceIdentity,
    openMarkdownPreview,
    revertActiveEditorChangeHunk,
    updateActiveDocument: rawUpdateActiveDocument,
  };
}
