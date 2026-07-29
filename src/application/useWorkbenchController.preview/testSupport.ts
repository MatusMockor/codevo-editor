import { act } from "react";
import { expect, vi } from "vitest";
import type { DebugEvent, DebugGateway } from "../../domain/debug";
import { emptyGitStatus, type GitGateway } from "../../domain/git";
import type { LanguageServerPlan, PhpLanguageServerPlanOptions } from "../../domain/languageServer";
import type { EditorPosition, LanguageServerRange } from "../../domain/languageServerFeatures";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "../../domain/languageServerRuntime";
import { defaultAppSettings } from "../../domain/settings";
import {
  type FileEntry,
  type ManagedPhpactorInstallCompletionEvent,
  type PhpProjectDescriptor,
  type WorkspaceDescriptor,
} from "../../domain/workspace";
import {
  flushAsyncTurns,
  type WorkbenchController,
} from "../../test/workbenchControllerTestHarness";
import {
  type PhpCodeActionDescriptor,
  type WorkbenchWorkspaceGateways,
} from "../useWorkbenchController";

// Shared test-only dependency surface for split controller suites.
export { callHierarchyRows } from "../../domain/callHierarchy";
export type { DebugGateway } from "../../domain/debug";
export { debugBreakpointStorageKey } from "../../domain/debugBreakpointPersistence";
export { deserializeBreakpoints, serializeBreakpoints } from "../../domain/debugBreakpoints";
export { createInitialEditorGroupsState } from "../../domain/editorGroups";
export { emptyGitStatus, gitChangeKey } from "../../domain/git";
export type { GitChangedFile, GitGateway } from "../../domain/git";
export type { IndexProgressGateway, MetadataScanCompletionEvent } from "../../domain/indexProgress";
export type { SmartModeGateway } from "../../domain/intelligence";
export { defaultKeymapSettings } from "../../domain/keymap";
export type {
  LanguageServerGateway,
  LanguageServerPlan,
  PhpLanguageServerPlanOptions,
} from "../../domain/languageServer";
export type {
  LanguageServerDiagnosticEvent,
  LanguageServerDiagnosticsGateway,
} from "../../domain/languageServerDiagnostics";
export { fileUriFromPath } from "../../domain/languageServerDocumentSync";
export type {
  LanguageServerCodeAction,
  LanguageServerFeaturesGateway,
  LanguageServerTextEdit,
  LanguageServerWorkspaceEdit,
} from "../../domain/languageServerFeatures";
export { emptyLanguageServerCapabilities } from "../../domain/languageServerRuntime";
export type {
  LanguageServerRuntimeGateway,
  LanguageServerRuntimeStatus,
} from "../../domain/languageServerRuntime";
export { emptyPhpFileOutline } from "../../domain/phpFileOutline";
export type { PhpFileOutlineGateway } from "../../domain/phpFileOutline";
export type { PhpTreeGateway } from "../../domain/phpTree";
export type {
  ProjectSymbolSearchGateway,
  ProjectSymbolSearchResult,
} from "../../domain/projectSymbols";
export { referenceRows } from "../../domain/referencesView";
export {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeWorkspaceSession,
} from "../../domain/settings";
export type { SettingsGateway } from "../../domain/settings";
export type { WorkspaceTrustGateway, WorkspaceTrustState } from "../../domain/trust";
export { typeHierarchyRows } from "../../domain/typeHierarchy";
export { defaultTextSearchOptions } from "../../domain/workspace";
export type {
  FileEntry,
  FileSearchResult,
  TextSearchResult,
  WorkspaceDescriptor,
} from "../../domain/workspace";
export type { WorkspaceFileChangeEvent } from "../../domain/workspaceFileChange";
export { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
export type { WorkspaceRuntimeLifecycleGateway } from "../../domain/workspaceRuntimeLifecycle";
export {
  flushTextSearchDebounce,
  resolveInReactAct,
  waitForReact,
} from "../../test/reactTestLifecycle";
export {
  featuresGateway,
  flushAsyncTurns,
  javaScriptTypeScriptWorkspaceDescriptor,
  setupWorkbenchControllerTestHarness,
} from "../../test/workbenchControllerTestHarness";
export type { WorkbenchController } from "../../test/workbenchControllerTestHarness";
export { EditorActiveLiveDocumentSaveCoordinator } from "../editorActiveLiveDocumentSaveCoordinator";
export {
  adoptLegacyCachedWorkspaceState,
  withWorkspaceIdentityLease,
} from "../useWorkbenchController";
export type { WorkbenchWorkspaceGateways } from "../useWorkbenchController";
export { act } from "react";
export { describe, expect, it, vi } from "vitest";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function completion(fields: Record<string, unknown>) {
  return expect.objectContaining(fields);
}

export function workspaceAppSettings() {
  return {
    ...defaultAppSettings(),
    recentWorkspacePath: "/workspace",
  };
}

export function readyJavaScriptTypeScriptPlan(rootPath: string): LanguageServerPlan {
  return {
    command: {
      args: ["--stdio"],
      executable: "typescript-language-server",
      workingDirectory: rootPath,
    },
    initializeRequest: {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {},
    },
    message: "TypeScript language server is ready.",
    provider: "typeScriptLanguageServer",
    status: "ready",
  };
}

export function trustedDescriptor(workspaceId: string, root: string) {
  return {
    workspaceId,
    selectedPath: root,
    canonicalRoot: root,
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved" as const,
    policy: {
      caseSensitive: true as const,
      unicodeNormalization: "none" as const,
    },
  };
}

export function runningStatus(rootPath: string, sessionId: number): LanguageServerRuntimeStatus {
  return {
    capabilities: emptyLanguageServerCapabilities(),
    kind: "running",
    rootPath,
    sessionId,
  };
}

export function createDeferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | null = null;
  let rejectValue: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  return {
    promise,
    reject(error: unknown) {
      rejectValue?.(error);
    },
    resolve(value: T) {
      resolveValue?.(value);
    },
  };
}

async function flushAfter(delay: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delay);
    });
  });
  await flushAsyncTurns();
}

export const flushWorkspaceDirectoryRefresh = () => flushAfter(150);
export const flushSearchEverywhereDebounce = () => flushAfter(150);
export const flushFilePrefetch = () => flushAfter(150);

export interface ManagedPhpactorInstallHarness {
  phpTools: WorkbenchWorkspaceGateways["phpTools"];
  emitCompletion: (event: ManagedPhpactorInstallCompletionEvent) => void;
}

export function createManagedPhpactorInstallHarness(
  overrides: Partial<WorkbenchWorkspaceGateways["phpTools"]> = {},
): ManagedPhpactorInstallHarness {
  const listeners = new Set<(event: ManagedPhpactorInstallCompletionEvent) => void>();

  const phpTools: WorkbenchWorkspaceGateways["phpTools"] = {
    detectPhpTools: vi.fn(async () => ({
      intelephense: null,
      phpactor: null,
    })),
    installManagedPhpactor: vi.fn(async () => undefined),
    subscribeManagedPhpactorInstall: vi.fn(async (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    ...overrides,
  };

  return {
    phpTools,
    emitCompletion(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

export async function waitForClassSearch(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 160));
    await Promise.resolve();
  });
}

export function phpactorLanguageServerPlan(): LanguageServerPlan {
  return {
    command: {
      args: ["language-server"],
      executable: "phpactor",
      workingDirectory: "/workspace",
    },
    initializeRequest: null,
    message: "PHPactor ready",
    provider: "phpactor",
    status: "ready",
  };
}

export function defaultPhpLanguageServerOptions(): PhpLanguageServerPlanOptions {
  return {
    intelephensePath: null,
    phpBackend: "auto",
    phpactorPath: null,
  };
}

export function phpWorkspaceDescriptor(
  phpOverrides: Partial<PhpProjectDescriptor> = {},
): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: phpProjectDescriptor(phpOverrides),
    rootPath: "/workspace",
  };
}

export function netteWorkspaceDescriptor(): WorkspaceDescriptor {
  return phpWorkspaceDescriptor({
    packageName: "nette/application",
    packages: [
      phpPackage(
        "nette/application",
        "../nette/application",
        "Nette\\Application\\",
        "src/",
        "3.2.0",
      ),
      phpPackage("latte/latte", "../latte/latte", "Latte\\", "src/", "3.0.0"),
    ],
  });
}

function phpPackage(
  name: string,
  installPath: string,
  namespace: string,
  path: string,
  version: string,
) {
  return {
    classmapRoots: [],
    dev: false,
    installPath,
    name,
    packageType: "library" as const,
    psr4Roots: [{ dev: false, namespace, paths: [path] }],
    version,
  };
}

export function phpProjectDescriptor(
  overrides: Partial<PhpProjectDescriptor> = {},
): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: "laravel/laravel",
    packages: [
      phpPackage(
        "laravel/framework",
        "../laravel/framework",
        "Illuminate\\",
        "src/Illuminate/",
        "13.0.0",
      ),
      phpPackage(
        "symfony/http-foundation",
        "../symfony/http-foundation",
        "Symfony\\Component\\HttpFoundation\\",
        "",
        "8.0.0",
      ),
    ],
    phpPlatformVersion: null,
    phpVersionConstraint: "^8.3",
    psr4Roots: [
      {
        dev: false,
        namespace: "App\\",
        paths: ["app/"],
      },
    ],
    ...overrides,
  };
}

export interface DebugGatewayHarness {
  gateway: DebugGateway;
  emit(event: DebugEvent): void;
  start: ReturnType<typeof vi.fn<DebugGateway["start"]>>;
}

export function createDebugGatewayHarness(): DebugGatewayHarness {
  const handlers = new Set<(event: DebugEvent) => void>();
  const noop = vi.fn(async () => undefined);
  const start = vi.fn<DebugGateway["start"]>().mockResolvedValue({ kind: "ok", sessionId: 7 });

  return {
    gateway: {
      start,
      stop: noop,
      disconnect: noop,
      setBreakpoints: vi.fn<DebugGateway["setBreakpoints"]>().mockResolvedValue([]),
      step: noop,
      pause: noop,
      restartFrame: noop,
      runToLocation: noop,
      setExceptionPause: noop,
      stackTrace: async () => [],
      scopesAtPause: vi.fn(),
      variablesPage: vi.fn(),
      setVariable: vi.fn(),
      setExpression: vi.fn(),
      evaluate: async () => null,
      subscribe(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    emit(event) {
      for (const handler of handlers) {
        handler(event);
      }
    },
    start,
  };
}

export function inMemoryBreakpointStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));

  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

export function runCommand(workbench: WorkbenchController, id: string): Promise<void> {
  const command = workbench.commands.find((entry) => entry.id === id);

  if (!command) {
    throw new Error(`Command not registered: ${id}`);
  }

  return Promise.resolve(command.run());
}

export function fileEntry(path: string, name: string): FileEntry {
  return {
    kind: "file",
    name,
    path,
  };
}

export function documentReadCount(readTextFile: { mock: { calls: unknown[][] } }): number {
  return readTextFile.mock.calls.filter(
    ([path]) => typeof path !== "string" || !path.endsWith("/.editorconfig"),
  ).length;
}

export function directoryEntry(path: string, name: string): FileEntry {
  return {
    kind: "directory",
    name,
    path,
  };
}

export function gitChangedFile(relativePath: string, isStaged: boolean) {
  return {
    isStaged,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `/workspace/${relativePath}`,
    relativePath,
    status: "modified" as const,
  };
}

export function fileHistoryGitGateway(overrides: Partial<GitGateway>): GitGateway {
  const statusMethods = Object.fromEntries(
    [
      "commit",
      "push",
      "getStatus",
      "revertFiles",
      "stageFiles",
      "stageHunk",
      "unstageFiles",
      "unstageHunk",
    ].map((name) => [name, vi.fn(async (rootPath: string) => emptyGitStatus(rootPath))]),
  );
  const arrayMethods = Object.fromEntries(
    ["blame", "getFileHunks", "stashList", "branchList"].map((name) => [
      name,
      vi.fn(async () => []),
    ]),
  );
  const voidMethods = Object.fromEntries(
    ["stashSave", "stashApply", "stashPop", "stashDrop", "createBranch", "switchBranch"].map(
      (name) => [name, vi.fn(async () => undefined)],
    ),
  );

  return {
    ...arrayMethods,
    ...statusMethods,
    ...voidMethods,
    fileHistory: overrides.fileHistory ?? vi.fn(async () => []),
    commit: overrides.commit ?? statusMethods.commit,
    fileCommitDiff:
      overrides.fileCommitDiff ??
      vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
    getDiff: vi.fn(async (_rootPath, requestedChange) => ({
      change: requestedChange,
      language: "plaintext",
      modifiedContent: "",
      originalContent: "",
    })),
    getStatus: overrides.getStatus ?? statusMethods.getStatus,
    stashShow: vi.fn(async () => ""),
    currentBranch: vi.fn(async () => null),
  } as unknown as GitGateway;
}

export function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): LanguageServerRange {
  return {
    end: {
      character: endCharacter,
      line: endLine,
    },
    start: {
      character: startCharacter,
      line: startLine,
    },
  };
}

export function positionAfter(source: string, needle: string): EditorPosition {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split(/\r?\n/);

  return {
    column: (lines[lines.length - 1] ?? "").length + 1,
    lineNumber: lines.length,
  };
}

export function lineNumberOf(source: string, needle: string): number {
  return positionAfter(source, needle).lineNumber;
}

export function monacoPositionToOffset(source: string, lineNumber: number, column: number): number {
  const lines = source.split("\n");
  let offset = 0;

  for (let index = 0; index < lineNumber - 1; index += 1) {
    offset += (lines[index] ?? "").length + 1;
  }

  return offset + (column - 1);
}

export function applyPhpDescriptorEdits(
  source: string,
  descriptor: PhpCodeActionDescriptor,
): string {
  const edits = descriptor.edits
    .map((edit) => ({
      start: monacoPositionToOffset(source, edit.range.startLineNumber, edit.range.startColumn),
      end: monacoPositionToOffset(source, edit.range.endLineNumber, edit.range.endColumn),
      text: edit.text,
    }))
    .sort((left, right) => right.start - left.start);

  return edits.reduce(
    (current, edit) => current.slice(0, edit.start) + edit.text + current.slice(edit.end),
    source,
  );
}

export function expectBalancedPhp(source: string): void {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const opens = new Set(["(", "[", "{"]);
  const stack: string[] = [];
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (opens.has(character)) {
      stack.push(character);
      continue;
    }

    const expected = pairs[character];

    if (expected) {
      expect(stack.pop()).toBe(expected);
    }
  }

  expect(stack).toHaveLength(0);
}
