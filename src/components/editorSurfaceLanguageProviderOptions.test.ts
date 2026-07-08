import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import type {
  LanguageServerFeaturesGateway,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { PhpParameterNameInlayHint } from "../domain/phpInlayHints";
import type {
  PhpMethodCompletion,
  PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import type { UserSnippet } from "../domain/snippets";
import type { EditorDocument } from "../domain/workspace";
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

describe("editor surface language provider options", () => {
  it("forwards provider callbacks through the current refs", async () => {
    const activeDocument = editorDocument();
    const runtimeStatus = {
      rootPath: "/workspace",
    } as LanguageServerRuntimeStatus;
    const userSnippets: UserSnippet[] = [];
    const refreshGateway = refreshGatewayStub();
    const workspaceEditGateway = workspaceEditGatewayStub();
    const refs = registrationRefs({
      activeDocument,
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
      editedOpenPaths: ["/workspace/app/Example.php"],
      rootPath: "/workspace",
    };
    const newFile = {
      content: "<?php\n",
      path: "/workspace/app/NewFile.php",
    } as PhpCodeActionNewFile;
    const error = new Error("boom");

    expect(options.featuresGateway).toBe(featuresGateway);
    expect(options.refreshGateway).toBe(refreshGateway);
    expect(options.workspaceEditGateway).toBe(workspaceEditGateway);
    expect(options.getActiveDocument()).toBe(activeDocument);
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
    ).resolves.toBeUndefined();
    options.clearLanguageServerDiagnosticsForPath?.(
      "/workspace/app/Example.php",
    );
    await expect(
      options.flushPendingDocumentChange("/workspace/app/Example.php"),
    ).resolves.toBeUndefined();
    await expect(
      options.provideBladeCodeActions?.("blade", codeActionRange),
    ).resolves.toEqual(codeActions);
    await expect(
      options.provideBladeCompletions?.("blade", position),
    ).resolves.toEqual(bladeCompletions);
    await expect(options.provideBladeDefinition?.("blade", 7)).resolves.toBe(
      true,
    );
    await expect(
      options.provideLatteCompletions?.("latte", position),
    ).resolves.toEqual(latteCompletions);
    await expect(options.provideLatteDefinition?.("latte", 8)).resolves.toBe(
      true,
    );
    await expect(
      options.provideNeonCompletions?.("neon", position),
    ).resolves.toEqual(neonCompletions);
    await expect(options.provideNeonDefinition?.("neon", 9)).resolves.toBe(true);
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
    expect(refs.bladeCodeActionsRef.current).toHaveBeenCalledWith(
      "blade",
      codeActionRange,
    );
    expect(refs.bladeCompletionsRef.current).toHaveBeenCalledWith(
      "blade",
      position,
    );
    expect(refs.bladeDefinitionRef.current).toHaveBeenCalledWith("blade", 7);
    expect(refs.latteCompletionsRef.current).toHaveBeenCalledWith(
      "latte",
      position,
    );
    expect(refs.latteDefinitionRef.current).toHaveBeenCalledWith("latte", 8);
    expect(refs.neonCompletionsRef.current).toHaveBeenCalledWith(
      "neon",
      position,
    );
    expect(refs.neonDefinitionRef.current).toHaveBeenCalledWith("neon", 9);
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
  workspaceRoot = "/workspace",
}: {
  refreshGateway?: LanguageServerRefreshGateway;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  workspaceRoot?: string | null;
} = {}): EditorSurfaceLanguageProviderOptionsDependencies {
  return {
    featuresGateway,
    refreshGateway,
    workspaceEditGateway,
    workspaceRoot,
  };
}

function registrationRefs({
  activeDocument = editorDocument(),
  runtimeStatus = null,
  userSnippets = [],
}: {
  activeDocument?: EditorDocument | null;
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
        ) => undefined,
      ),
    ),
    bladeCodeActionsRef: ref(vi.fn(async () => codeActions)),
    bladeCompletionsRef: ref(vi.fn(async () => bladeCompletions)),
    bladeDefinitionRef: ref(vi.fn(async () => true)),
    clearLanguageServerDiagnosticsForPathRef: ref(vi.fn()),
    errorReporterRef: ref(vi.fn()),
    flushPendingRef: ref(vi.fn(async () => undefined)),
    isLanguageServerDocumentSyncedRef: ref(undefined),
    latteCompletionsRef: ref(vi.fn(async () => latteCompletions)),
    latteDefinitionRef: ref(vi.fn(async () => true)),
    neonCompletionsRef: ref(vi.fn(async () => neonCompletions)),
    neonDefinitionRef: ref(vi.fn(async () => true)),
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
    userSnippetsRef: ref(userSnippets),
  };
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
