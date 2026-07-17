import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import type {
  LanguageServerFeaturesGateway,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import type { PhpParameterNameInlayHint } from "../domain/phpInlayHints";
import type {
  PhpMethodCompletion,
  PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import type { UserSnippet } from "../domain/snippets";
import type { EditorDocument, FileEntry } from "../domain/workspace";
import {
  createEditorSurfaceLanguageProviderOptions,
  type EditorSurfaceLanguageProviderOptionsDependencies,
  type EditorSurfaceLanguageProviderRegistrationRefs,
} from "./editorSurfaceLanguageProviderOptions";
import type {
  BladeCompletion,
  LatteCompletion,
  NeonCompletion,
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
  PhpWorkspaceEditApplicationContext,
} from "./languageServerMonacoProviders";
import type { WorkspaceIdentityDescriptor } from "./phpMonacoDocumentContext";

describe("editor surface language provider options", () => {
  it("forwards provider callbacks through the current refs", async () => {
    const activeDocument = editorDocument();
    const runtimeStatus = {
      rootPath: "/workspace",
    } as LanguageServerRuntimeStatus;
    const largeSmartDocumentPolicy = { characterLimit: 1024, lineLimit: 100 };
    const userSnippets: UserSnippet[] = [];
    const refreshGateway = refreshGatewayStub();
    const workspaceEditGateway = workspaceEditGatewayStub();
    const refs = registrationRefs({
      activeDocument,
      largeSmartDocumentPolicy,
      runtimeStatus,
      userSnippets,
    });
    const options = createEditorSurfaceLanguageProviderOptions({
      dependencies: dependencies({ refreshGateway, workspaceEditGateway }),
      refs,
    });
    const position = monacoPosition();
    const codeActionRange = range();
    const inlayHintRange = { endLine: 3, startLine: 1 };
    const workspaceEdit = { changes: {} };
    const workspaceEditContext = {
      openPaths: ["/workspace/app/Example.php"],
      rootPath: "/workspace",
    };
    const newFile = {
      content: "<?php\n",
      path: "/workspace/app/NewFile.php",
    } as PhpCodeActionNewFile;
    const error = new Error("boom");
    const templateLanguageProviders = options.getTemplateLanguageProviders();

    expect(options.featuresGateway).toBe(featuresGateway);
    expect(options.refreshGateway).toBe(refreshGateway);
    expect(options.workspaceEditGateway).toBe(workspaceEditGateway);
    expect(options.getActiveDocument()).toBe(activeDocument);
    expect(options.getLargeSmartDocumentPolicy?.()).toBe(largeSmartDocumentPolicy);
    expect(options.getRuntimeStatus()).toBe(runtimeStatus);
    expect(options.getUserSnippets?.()).toBe(userSnippets);
    expect(options.getWorkspaceRoot?.()).toBe("/workspace");
    expect(options.isPhpInlayHintsEnabled?.()).toBe(true);
    expect(options.limitNavigationResultsToOpenModels).toBe(true);

    await expect(options.applyPhpCodeActionNewFile?.(newFile)).resolves.toBe(
      true,
    );
    await expect(
      options.applyWorkspaceEdit?.(workspaceEdit, workspaceEditContext),
    ).resolves.toEqual({ kind: "accepted" });
    options.clearLanguageServerDiagnosticsForPath?.(
      "/workspace/app/Example.php",
    );
    await expect(
      options.flushPendingDocumentChange("/workspace/app/Example.php"),
    ).resolves.toBeUndefined();
    await expect(
      templateLanguageProviders.blade.provideCodeActions(
        "blade",
        codeActionRange,
      ),
    ).resolves.toEqual(codeActions);
    await expect(
      templateLanguageProviders.blade.provideCompletions("blade", position),
    ).resolves.toEqual(bladeCompletions);
    await expect(
      templateLanguageProviders.blade.provideDefinition("blade", 7),
    ).resolves.toBe(true);
    await expect(
      templateLanguageProviders.latte.provideCompletions("latte", position),
    ).resolves.toEqual(latteCompletions);
    await expect(
      templateLanguageProviders.latte.provideCodeActions(
        "latte",
        codeActionRange,
      ),
    ).resolves.toEqual(codeActions);
    await expect(
      templateLanguageProviders.latte.provideDefinition("latte", 8),
    ).resolves.toBe(true);
    await expect(
      templateLanguageProviders.neon.provideCompletions("neon", position),
    ).resolves.toEqual(neonCompletions);
    await expect(
      templateLanguageProviders.neon.provideDefinition("neon", 9),
    ).resolves.toBe(true);
    await expect(
      options.providePhpPresenterLinkDefinition?.("php", 10),
    ).resolves.toBe(true);
    await expect(
      options.providePhpPresenterLinkCompletions?.("php", 11),
    ).resolves.toEqual(latteCompletions);
    expect(options.isPhpPresenterLinkCompletionContext?.("php", 12)).toBe(true);
    expect(options.isPhpFrameworkStringCompletionContext?.("php", position)).toBe(
      true,
    );
    await expect(
      options.providePhpCodeActions?.("php", codeActionRange),
    ).resolves.toEqual(codeActions);
    await expect(
      options.providePhpFrameworkDefinition?.("php", 13),
    ).resolves.toBe(true);
    await expect(
      options.providePhpMethodCompletions?.("php", position),
    ).resolves.toEqual(methodCompletions);
    await expect(
      options.providePhpMethodSignature?.("php", position),
    ).resolves.toBe(methodSignature);
    await expect(
      options.providePhpParameterInlayHints?.("php", inlayHintRange),
    ).resolves.toEqual(parameterInlayHints);
    options.recordCompletionLatency?.(24, "/workspace");
    options.reportError(error);

    expect(refs.applyPhpCodeActionNewFileRef.current).toHaveBeenCalledWith(
      newFile,
    );
    expect(refs.applyPhpWorkspaceEditRef.current).toHaveBeenCalledWith(
      workspaceEdit,
      workspaceEditContext,
    );
    expect(
      refs.clearLanguageServerDiagnosticsForPathRef.current,
    ).toHaveBeenCalledWith("/workspace/app/Example.php");
    expect(refs.flushPendingRef.current).toHaveBeenCalledWith(
      "/workspace/app/Example.php",
    );
    expect(
      refs.templateLanguageProvidersRef.current.blade.provideCodeActions,
    ).toHaveBeenCalledWith("blade", codeActionRange);
    expect(
      refs.templateLanguageProvidersRef.current.blade.provideCompletions,
    ).toHaveBeenCalledWith("blade", position);
    expect(
      refs.templateLanguageProvidersRef.current.blade.provideDefinition,
    ).toHaveBeenCalledWith("blade", 7);
    expect(
      refs.templateLanguageProvidersRef.current.latte.provideCompletions,
    ).toHaveBeenCalledWith("latte", position);
    expect(
      refs.templateLanguageProvidersRef.current.latte.provideDefinition,
    ).toHaveBeenCalledWith("latte", 8);
    expect(
      refs.templateLanguageProvidersRef.current.neon.provideCompletions,
    ).toHaveBeenCalledWith("neon", position);
    expect(
      refs.templateLanguageProvidersRef.current.neon.provideDefinition,
    ).toHaveBeenCalledWith("neon", 9);
    expect(refs.phpPresenterLinkDefinitionRef.current).toHaveBeenCalledWith(
      "php",
      10,
    );
    expect(refs.phpPresenterLinkCompletionsRef.current).toHaveBeenCalledWith(
      "php",
      11,
    );
    expect(
      refs.phpPresenterLinkCompletionContextRef.current,
    ).toHaveBeenCalledWith("php", 12);
    expect(
      refs.phpFrameworkStringCompletionContextRef.current,
    ).toHaveBeenCalledWith("php", position);
    expect(refs.phpCodeActionsRef.current).toHaveBeenCalledWith(
      "php",
      codeActionRange,
    );
    expect(refs.phpFrameworkDefinitionRef.current).toHaveBeenCalledWith(
      "php",
      13,
    );
    expect(refs.phpMethodCompletionsRef.current).toHaveBeenCalledWith(
      "php",
      position,
    );
    expect(refs.phpMethodSignatureRef.current).toHaveBeenCalledWith(
      "php",
      position,
    );
    expect(refs.phpParameterInlayHintsRef.current).toHaveBeenCalledWith(
      "php",
      inlayHintRange,
    );
    expect(refs.recordCompletionLatencyRef.current).toHaveBeenCalledWith(
      24,
      "/workspace",
    );
    expect(refs.errorReporterRef.current).toHaveBeenCalledWith(error);
  });

  it("uses workspace root key equality before consulting document sync state", () => {
    const refs = registrationRefs();
    const isDocumentSynced = vi.fn(() => true);
    refs.isLanguageServerDocumentSyncedRef.current = isDocumentSynced;
    const options = createEditorSurfaceLanguageProviderOptions({
      dependencies: dependencies({ workspaceRoot: "/workspace/" }),
      refs,
    });

    expect(
      options.isDocumentSynced?.("/workspace", "/workspace/app/Example.php"),
    ).toBe(true);
    expect(isDocumentSynced).toHaveBeenCalledWith(
      "/workspace/app/Example.php",
    );

    isDocumentSynced.mockClear();

    expect(
      options.isDocumentSynced?.(
        "/other-workspace",
        "/workspace/app/Example.php",
      ),
    ).toBe(false);
    expect(isDocumentSynced).not.toHaveBeenCalled();
  });

  it("reads the current template registry after options creation", () => {
    const refs = registrationRefs();
    const options = createEditorSurfaceLanguageProviderOptions({
      dependencies: dependencies(),
      refs,
    });
    const nextRegistry = registrationRefs().templateLanguageProvidersRef.current;

    refs.templateLanguageProvidersRef.current = nextRegistry;

    expect(options.getTemplateLanguageProviders()).toBe(nextRegistry);
  });

  describe("readTemplateFileContent", () => {
    beforeEach(() => {
      invoke.mockReset();
    });

    it("reads template content inside the active workspace root", async () => {
      invoke.mockResolvedValue("{block content}Hi{/block}");
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies(),
        refs: registrationRefs(),
      });

      await expect(
        options.readTemplateFileContent(
          "/workspace/app/templates/@layout.latte",
        ),
      ).resolves.toBe("{block content}Hi{/block}");
      expect(invoke).toHaveBeenCalledWith("read_text_file", {
        path: "/workspace/app/templates/@layout.latte",
      });
    });

    it("routes reads through the trusted workspace command when identity is known", async () => {
      invoke.mockResolvedValue({ content: "{block sidebar}{/block}", revision: 3 });
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies({
          workspaceIdentityDescriptor: identityDescriptor(),
        }),
        refs: registrationRefs(),
      });

      await expect(
        options.readTemplateFileContent(
          "/workspace/app/templates/@layout.latte",
        ),
      ).resolves.toBe("{block sidebar}{/block}");
      expect(invoke).toHaveBeenCalledWith("workspace_read_text_file", {
        workspaceId: "ws-1",
        relativePath: "app/templates/@layout.latte",
      });
    });

    it("refuses paths outside the active workspace root", async () => {
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies(),
        refs: registrationRefs(),
      });

      await expect(
        options.readTemplateFileContent("/elsewhere/@layout.latte"),
      ).resolves.toBeNull();
      await expect(
        options.readTemplateFileContent("/workspace/../secrets/@layout.latte"),
      ).resolves.toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    });

    it("refuses descriptor-relative paths outside the trusted workspace root", async () => {
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies({
          workspaceIdentityDescriptor: identityDescriptor(),
        }),
        refs: registrationRefs(),
      });

      await expect(
        options.readTemplateFileContent("/elsewhere/@layout.latte"),
      ).resolves.toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    });

    it("refuses reads when no workspace root is active", async () => {
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies({ workspaceRoot: null }),
        refs: registrationRefs(),
      });

      await expect(
        options.readTemplateFileContent(
          "/workspace/app/templates/@layout.latte",
        ),
      ).resolves.toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    });

    it("returns null when reading the template file fails", async () => {
      invoke.mockRejectedValue(new Error("read failed"));
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies(),
        refs: registrationRefs(),
      });

      await expect(
        options.readTemplateFileContent(
          "/workspace/app/templates/@layout.latte",
        ),
      ).resolves.toBeNull();
    });
  });

  describe("listWorkspaceTemplateFiles", () => {
    beforeEach(() => {
      invoke.mockReset();
    });

    it("collects latte templates across nested workspace directories", async () => {
      mockDirectoryTree({
        "/workspace": [
          directoryEntry("/workspace/app"),
          fileEntry("/workspace/readme.md"),
        ],
        "/workspace/app": [
          directoryEntry("/workspace/app/templates"),
          fileEntry("/workspace/app/Bootstrap.php"),
        ],
        "/workspace/app/templates": [
          fileEntry("/workspace/app/templates/@layout.latte"),
          directoryEntry("/workspace/app/templates/Product"),
        ],
        "/workspace/app/templates/Product": [
          fileEntry("/workspace/app/templates/Product/show.latte"),
        ],
      });
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies(),
        refs: registrationRefs(),
      });

      const listed = await options.listWorkspaceTemplateFiles("/workspace");

      expect(listed?.slice().sort()).toEqual([
        "/workspace/app/templates/@layout.latte",
        "/workspace/app/templates/Product/show.latte",
      ]);
    });

    it("skips vendor, node_modules and dot directories", async () => {
      mockDirectoryTree({
        "/workspace": [
          directoryEntry("/workspace/vendor"),
          directoryEntry("/workspace/node_modules"),
          directoryEntry("/workspace/.git"),
          directoryEntry("/workspace/templates"),
        ],
        "/workspace/templates": [
          fileEntry("/workspace/templates/home.latte"),
        ],
      });
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies(),
        refs: registrationRefs(),
      });

      await expect(
        options.listWorkspaceTemplateFiles("/workspace"),
      ).resolves.toEqual(["/workspace/templates/home.latte"]);
      expect(readDirectoryCallPaths()).toEqual([
        "/workspace",
        "/workspace/templates",
      ]);
    });

    it("stops collecting once the 2001 template limit is reached", async () => {
      const templates = Array.from({ length: 2005 }, (_, index) =>
        fileEntry(`/workspace/templates/t${index}.latte`),
      );
      mockDirectoryTree({
        "/workspace": [...templates, directoryEntry("/workspace/extra")],
        "/workspace/extra": [fileEntry("/workspace/extra/more.latte")],
      });
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies(),
        refs: registrationRefs(),
      });

      const listed = await options.listWorkspaceTemplateFiles("/workspace");

      expect(listed).toHaveLength(2001);
      expect(readDirectoryCallPaths()).toEqual(["/workspace"]);
    });

    it("returns null when reading the root directory fails", async () => {
      invoke.mockRejectedValue(new Error("read failed"));
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies(),
        refs: registrationRefs(),
      });

      await expect(
        options.listWorkspaceTemplateFiles("/workspace"),
      ).resolves.toBeNull();
    });

    it("refuses roots outside the active workspace root", async () => {
      const options = createEditorSurfaceLanguageProviderOptions({
        dependencies: dependencies(),
        refs: registrationRefs(),
      });

      await expect(
        options.listWorkspaceTemplateFiles("/elsewhere"),
      ).resolves.toBeNull();
      await expect(
        options.listWorkspaceTemplateFiles("/workspace/../secrets"),
      ).resolves.toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  it("keeps document sync isolated when no active workspace root is registered", () => {
    const refs = registrationRefs();
    const isDocumentSynced = vi.fn(() => true);
    refs.isLanguageServerDocumentSyncedRef.current = isDocumentSynced;
    const options = createEditorSurfaceLanguageProviderOptions({
      dependencies: dependencies({ workspaceRoot: null }),
      refs,
    });

    expect(
      options.isDocumentSynced?.("/workspace", "/workspace/app/Example.php"),
    ).toBe(false);
    expect(isDocumentSynced).not.toHaveBeenCalled();
  });
});

const featuresGateway = {} as LanguageServerFeaturesGateway;
const codeActions = [{ title: "Fix it" }] as PhpCodeActionDescriptor[];
const bladeCompletions = [
  { insertText: "@if", kind: "directive", label: "@if" },
] satisfies BladeCompletion[];
const latteCompletions = [
  { insertText: "Product:show", kind: "link", label: "Product:show" },
] satisfies LatteCompletion[];
const neonCompletions = [
  { insertText: "App\\\\Service", kind: "class", label: "App\\\\Service" },
] satisfies NeonCompletion[];
const methodCompletions = [
  {
    declaringClassName: "App\\\\Model",
    name: "save",
    parameters: "()",
    returnType: "bool",
  },
] satisfies PhpMethodCompletion[];
const methodSignature = {
  argumentIndex: 0,
  method: methodCompletions[0],
  parameters: [],
} satisfies PhpMethodSignature;
const parameterInlayHints = [
  { character: 8, line: 1, name: "force" },
] satisfies PhpParameterNameInlayHint[];

function dependencies({
  refreshGateway,
  workspaceEditGateway,
  workspaceIdentityDescriptor = null,
  workspaceRoot = "/workspace",
}: {
  refreshGateway?: LanguageServerRefreshGateway;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  workspaceIdentityDescriptor?: WorkspaceIdentityDescriptor | null;
  workspaceRoot?: string | null;
} = {}): EditorSurfaceLanguageProviderOptionsDependencies {
  return {
    featuresGateway,
    refreshGateway,
    workspaceEditGateway,
    workspaceIdentityDescriptor,
    workspaceRoot,
  };
}

function identityDescriptor(): WorkspaceIdentityDescriptor {
  return {
    workspaceId: "ws-1",
    selectedPath: "/workspace",
    canonicalRoot: "/workspace",
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved",
    policy: { caseSensitive: true, unicodeNormalization: "none" },
  };
}

function registrationRefs({
  activeDocument = editorDocument(),
  largeSmartDocumentPolicy = { characterLimit: 1024, lineLimit: 100 },
  runtimeStatus = null,
  userSnippets = [],
}: {
  activeDocument?: EditorDocument | null;
  largeSmartDocumentPolicy?: LargeSmartDocumentPolicy;
  runtimeStatus?: LanguageServerRuntimeStatus | null;
  userSnippets?: readonly UserSnippet[];
} = {}): EditorSurfaceLanguageProviderRegistrationRefs {
  return {
    activeDocumentRef: ref(activeDocument),
    applyPhpCodeActionNewFileRef: ref(vi.fn(async () => true)),
    applyPhpWorkspaceEditRef: ref(
      vi.fn(
        async (
          _edit: LanguageServerWorkspaceEdit,
          _context: PhpWorkspaceEditApplicationContext,
        ) => ({ kind: "accepted" as const }),
      ),
    ),
    clearLanguageServerDiagnosticsForPathRef: ref(vi.fn()),
    errorReporterRef: ref(vi.fn()),
    flushPendingRef: ref(vi.fn(async () => undefined)),
    isLanguageServerDocumentSyncedRef: ref(undefined),
    largeSmartDocumentPolicyRef: ref(largeSmartDocumentPolicy),
    phpCodeActionsRef: ref(vi.fn(async () => codeActions)),
    phpFrameworkDefinitionRef: ref(vi.fn(async () => true)),
    phpFrameworkStringCompletionContextRef: ref(vi.fn(() => true)),
    phpInlayHintsEnabledRef: ref(true),
    phpMethodCompletionsRef: ref(vi.fn(async () => methodCompletions)),
    phpMethodSignatureRef: ref(vi.fn(async () => methodSignature)),
    phpParameterInlayHintsRef: ref(vi.fn(async () => parameterInlayHints)),
    phpPresenterLinkCompletionsRef: ref(vi.fn(async () => latteCompletions)),
    phpPresenterLinkCompletionContextRef: ref(vi.fn(() => true)),
    phpPresenterLinkDefinitionRef: ref(vi.fn(async () => true)),
    recordCompletionLatencyRef: ref(vi.fn()),
    runtimeStatusRef: ref(runtimeStatus),
    templateLanguageProvidersRef: ref({
      blade: {
        provideCodeActions: vi.fn(async () => codeActions),
        provideCompletions: vi.fn(async () => bladeCompletions),
        provideDefinition: vi.fn(async () => true),
      },
      latte: {
        provideCodeActions: vi.fn(async () => codeActions),
        provideCompletions: vi.fn(async () => latteCompletions),
        provideDefinition: vi.fn(async () => true),
      },
      neon: {
        provideCompletions: vi.fn(async () => neonCompletions),
        provideDefinition: vi.fn(async () => true),
      },
    }),
    userSnippetsRef: ref(userSnippets),
  };
}

function mockDirectoryTree(tree: Record<string, FileEntry[]>): void {
  invoke.mockImplementation(async (_command: string, args?: unknown) => {
    const { path } = args as { path: string };

    return tree[path] ?? [];
  });
}

function readDirectoryCallPaths(): string[] {
  return invoke.mock.calls.map(
    ([, args]) => (args as { path: string }).path,
  );
}

function directoryEntry(path: string): FileEntry {
  return { kind: "directory", name: entryName(path), path };
}

function fileEntry(path: string): FileEntry {
  return { kind: "file", name: entryName(path), path };
}

function entryName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function refreshGatewayStub(): LanguageServerRefreshGateway {
  return {
    subscribeRefreshEvents: vi.fn(async () => vi.fn()),
  };
}

function workspaceEditGatewayStub(): LanguageServerWorkspaceEditGateway {
  return {
    subscribeWorkspaceEdits: vi.fn(async () => vi.fn()),
  };
}

function editorDocument(): EditorDocument {
  return {
    content: "<?php\nclass Example {}\n",
    language: "php",
    name: "Example.php",
    path: "/workspace/app/Example.php",
    savedContent: "",
  };
}

function monacoPosition(): Monaco.Position {
  return { column: 3, lineNumber: 2 } as Monaco.Position;
}

function range(): PhpCodeActionRange {
  return {
    end: 12,
    start: 4,
  };
}

function ref<T>(current: T): MutableRefObject<T> {
  return { current };
}
