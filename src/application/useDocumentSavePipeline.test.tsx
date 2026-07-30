// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  IdentifiedLanguageServerRequest,
  IdentifiedLanguageServerRequestsPort,
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerCodeAction,
  LanguageServerCodeActionContext,
  LanguageServerFeaturesGateway,
  LanguageServerRange,
  LanguageServerTextEdit,
} from "../domain/languageServerFeatures";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import { MAX_JAVA_SCRIPT_TYPE_SCRIPT_SAVE_PARTICIPANT_UTF16_UNITS } from "../domain/javaScriptTypeScriptSaveParticipantPolicy";
import { defaultWorkspaceSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  useDocumentSavePipeline,
  type DocumentSavePipeline,
  type DocumentSavePipelineDependencies,
} from "./useDocumentSavePipeline";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

function editorDocument(path: string, content: string, language = "typescript"): EditorDocument {
  return {
    content,
    language,
    name: path.split("/").pop() ?? path,
    path,
    savedContent: content,
  };
}

function runningStatus(
  capabilities: Partial<Extract<LanguageServerRuntimeStatus, { kind: "running" }>["capabilities"]>,
  sessionId = 7,
): LanguageServerRuntimeStatus {
  return {
    capabilities: {
      ...emptyLanguageServerCapabilities(),
      ...capabilities,
    },
    kind: "running",
    rootPath: ROOT,
    sessionId,
  };
}

function fullTextEdit(content: string, newText: string): LanguageServerTextEdit {
  const lines = content.split("\n");

  return {
    newText,
    range: {
      end: {
        character: lines[lines.length - 1]?.length ?? 0,
        line: lines.length - 1,
      },
      start: { character: 0, line: 0 },
    },
  };
}

function action(
  path: string,
  content: string,
  newText: string,
  kind = "source.organizeImports",
): LanguageServerCodeAction {
  return {
    command: null,
    data: null,
    edit: {
      changes: {
        [fileUriFromPath(path)]: [fullTextEdit(content, newText)],
      },
    },
    isPreferred: false,
    kind,
    title: kind,
  };
}

function commandOnlyAction(kind: string): LanguageServerCodeAction {
  return {
    command: {
      arguments: [],
      command: "_typescript.organizeImports",
      title: kind,
    },
    data: null,
    edit: null,
    isPreferred: false,
    kind,
    title: kind,
  };
}

function dataOnlyAction(kind = "source.organizeImports"): LanguageServerCodeAction {
  return {
    command: null,
    data: { requestId: kind },
    edit: null,
    isPreferred: false,
    kind,
    title: kind,
  };
}

function featuresGateway(
  overrides: Partial<LanguageServerFeaturesGateway> = {},
): LanguageServerFeaturesGateway & JavaScriptTypeScriptLanguageServerFeaturesGateway {
  const codeActions = overrides.codeActions ?? (async () => []);
  const formatting = overrides.formatting ?? (async () => []);
  const resolveCodeAction =
    overrides.resolveCodeAction ?? (async (_root, codeAction) => codeAction);
  const formattingRequest = vi.fn((rootPath, path, options, sessionId = 1) =>
    identified(formatting(rootPath, path, options), sessionId),
  );
  const identifiedRequestPort = overrides.identifiedRequests
    ? {
        ...overrides.identifiedRequests,
        formatting: overrides.identifiedRequests.formatting ?? formattingRequest,
      }
    : ({
        cancelRequest: vi.fn(async () => undefined),
        formatting: formattingRequest,
      } as unknown as IdentifiedLanguageServerRequestsPort);
  return {
    ...overrides,
    codeActions: vi.fn((rootPath, path, range, context, sessionId = 1) =>
      identified(codeActions(rootPath, path, range, context), sessionId),
    ),
    formatting: formattingRequest,
    identifiedRequests: identifiedRequestPort,
    resolveCodeAction: vi.fn((rootPath, action, sessionId = 1) =>
      identified(resolveCodeAction(rootPath, action), sessionId),
    ),
  } as unknown as LanguageServerFeaturesGateway & JavaScriptTypeScriptLanguageServerFeaturesGateway;
}

function identified<T>(
  promise: Promise<T>,
  sessionId: number,
  requestId = 1,
): IdentifiedLanguageServerRequest<T> {
  return Object.assign(promise, { requestId, sessionId });
}

function deferred<T>(
  sessionId = 7,
  requestId = 1,
): {
  promise: IdentifiedLanguageServerRequest<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
} {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });

  return {
    promise: identified(promise, sessionId, requestId),
    reject,
    resolve,
  };
}

function identifiedRequests(
  cancelRequest: IdentifiedLanguageServerRequestsPort["cancelRequest"],
): IdentifiedLanguageServerRequestsPort {
  return { cancelRequest } as IdentifiedLanguageServerRequestsPort;
}

function makeDeps(
  overrides: Partial<DocumentSavePipelineDependencies> = {},
): DocumentSavePipelineDependencies {
  return {
    flushPendingDocumentChangeForRoot: vi.fn(async () => undefined),
    flushPendingJavaScriptTypeScriptDocumentChangeForRoot: vi.fn(async () => undefined),
    hasPhpWorkspace: false,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(() => true),
    isLanguageServerSessionActiveForRoot: vi.fn(() => true),
    javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGateway(),
    javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
      current: null,
    },
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: {
      current: ROOT,
    },
    languageServerFeaturesGateway: featuresGateway(),
    languageServerRuntimeStatusRef: { current: null },
    languageServerRuntimeStatusRootRef: { current: ROOT },
    workspaceSettingsRef: { current: defaultWorkspaceSettings() },
    ...overrides,
  };
}

function renderPipeline(deps: DocumentSavePipelineDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { pipeline: DocumentSavePipeline | null } = {
    pipeline: null,
  };

  function Harness({ dependencies }: { dependencies: DocumentSavePipelineDependencies }) {
    captured.pipeline = useDocumentSavePipeline(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const pipeline = (): DocumentSavePipeline => {
    if (!captured.pipeline) {
      throw new Error("hook not mounted");
    }

    return captured.pipeline;
  };

  return {
    pipeline,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useDocumentSavePipeline", () => {
  it("returns original content without LSP calls when format on save is disabled", async () => {
    const jsTsGateway = featuresGateway();
    const deps = makeDeps({
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: runningStatus({ formatting: true }),
      },
    });
    const harness = renderPipeline(deps);
    const document = editorDocument(`${ROOT}/src/App.ts`, "const value = 1;\n");

    const result = await harness.pipeline().formattedContentForSave(document, ROOT);

    expect(result).toBe(document.content);
    expect(jsTsGateway.formatting).not.toHaveBeenCalled();
    expect(deps.flushPendingJavaScriptTypeScriptDocumentChangeForRoot).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("flushes pending JS/TS changes before formatting and applies text edits", async () => {
    const events: string[] = [];
    const original = "const value = 1;\n";
    const formatted = "const value = 2;\n";
    const jsTsGateway = featuresGateway({
      formatting: vi.fn(async () => {
        events.push("format");
        return [fullTextEdit(original, formatted)];
      }),
    });
    const deps = makeDeps({
      flushPendingJavaScriptTypeScriptDocumentChangeForRoot: vi.fn(async (rootPath, path) => {
        events.push(`flush:${rootPath}:${path}`);
      }),
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: runningStatus({ formatting: true }),
      },
      workspaceSettingsRef: {
        current: { ...defaultWorkspaceSettings(), formatOnSave: true },
      },
    });
    const harness = renderPipeline(deps);

    const result = await harness
      .pipeline()
      .formattedContentForSave(editorDocument(`${ROOT}/src/App.ts`, original), ROOT);

    expect(events).toEqual([`flush:${ROOT}:${ROOT}/src/App.ts`, "format"]);
    expect(result).toBe(formatted);
    expect(jsTsGateway.formatting).toHaveBeenCalledWith(
      ROOT,
      `${ROOT}/src/App.ts`,
      expect.objectContaining({ insertSpaces: true, tabSize: 4 }),
      7,
    );
    harness.unmount();
  });

  it("does not flush or request JS/TS LSP save participants above the snapshot limit", async () => {
    const jsTsGateway = featuresGateway();
    const deps = makeDeps({
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: runningStatus({ codeAction: true, formatting: true }),
      },
      workspaceSettingsRef: {
        current: {
          ...defaultWorkspaceSettings(),
          formatOnSave: true,
          javaScriptTypeScriptOrganizeImportsOnSave: true,
        },
      },
    });
    const harness = renderPipeline(deps);
    const content = "x".repeat(MAX_JAVA_SCRIPT_TYPE_SCRIPT_SAVE_PARTICIPANT_UTF16_UNITS + 1);
    const document = editorDocument(`${ROOT}/src/large.ts`, content);

    await expect(harness.pipeline().formattedContentForSave(document, ROOT)).resolves.toBe(content);
    await expect(
      harness.pipeline().organizedImportsContentForSave(document, content, ROOT),
    ).resolves.toBe(content);

    expect(deps.flushPendingJavaScriptTypeScriptDocumentChangeForRoot).not.toHaveBeenCalled();
    expect(jsTsGateway.formatting).not.toHaveBeenCalled();
    expect(jsTsGateway.codeActions).not.toHaveBeenCalled();
    expect(jsTsGateway.resolveCodeAction).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not request source actions when formatting grows exact-limit content", async () => {
    const jsTsGateway = featuresGateway();
    const deps = makeDeps({
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: runningStatus({ codeAction: true }),
      },
      workspaceSettingsRef: {
        current: {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptOrganizeImportsOnSave: true,
        },
      },
    });
    const harness = renderPipeline(deps);
    const documentContent = "x".repeat(MAX_JAVA_SCRIPT_TYPE_SCRIPT_SAVE_PARTICIPANT_UTF16_UNITS);
    const formattedContent = `${documentContent}x`;
    const document = editorDocument(`${ROOT}/src/large.ts`, documentContent);

    await expect(
      harness.pipeline().organizedImportsContentForSave(document, formattedContent, ROOT),
    ).resolves.toBe(formattedContent);

    expect(deps.flushPendingJavaScriptTypeScriptDocumentChangeForRoot).not.toHaveBeenCalled();
    expect(jsTsGateway.codeActions).not.toHaveBeenCalled();
    expect(jsTsGateway.resolveCodeAction).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("forwards the requested root when flushing PHP changes before formatting", async () => {
    const events: string[] = [];
    const path = `${ROOT}/src/App.php`;
    const original = "<?php\n$value=1;\n";
    const formatted = "<?php\n$value = 1;\n";
    const phpGateway = featuresGateway({
      formatting: vi.fn(async (rootPath, requestedPath) => {
        events.push(`format:${rootPath}:${requestedPath}`);
        return [fullTextEdit(original, formatted)];
      }),
    });
    const deps = makeDeps({
      flushPendingDocumentChangeForRoot: vi.fn(async (rootPath, requestedPath) => {
        events.push(`flush:${rootPath}:${requestedPath}`);
      }),
      hasPhpWorkspace: true,
      languageServerFeaturesGateway: phpGateway,
      languageServerRuntimeStatusRef: {
        current: runningStatus({ formatting: true }),
      },
      workspaceSettingsRef: {
        current: { ...defaultWorkspaceSettings(), formatOnSave: true },
      },
    });
    const harness = renderPipeline(deps);

    const result = await harness
      .pipeline()
      .formattedContentForSave(editorDocument(path, original, "php"), ROOT);

    expect(events).toEqual([`flush:${ROOT}:${path}`, `format:${ROOT}:${path}`]);
    expect(result).toBe(formatted);
    harness.unmount();
  });

  it("does not format when the root-aware flush observes a root mismatch", async () => {
    const path = `${ROOT}/src/App.ts`;
    const activeRoot = "/other-workspace";
    const jsTsGateway = featuresGateway();
    let active = true;
    const deps = makeDeps({
      flushPendingJavaScriptTypeScriptDocumentChangeForRoot: vi.fn(async (requestedRoot) => {
        active = requestedRoot === activeRoot;
      }),
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(() => active),
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: runningStatus({ formatting: true }),
      },
      workspaceSettingsRef: {
        current: { ...defaultWorkspaceSettings(), formatOnSave: true },
      },
    });
    const harness = renderPipeline(deps);
    const document = editorDocument(path, "const value = 1;\n");

    const result = await harness.pipeline().formattedContentForSave(document, ROOT);

    expect(deps.flushPendingJavaScriptTypeScriptDocumentChangeForRoot).toHaveBeenCalledWith(
      ROOT,
      path,
    );
    expect(jsTsGateway.formatting).not.toHaveBeenCalled();
    expect(result).toBe(document.content);
    harness.unmount();
  });

  it("returns original content when formatting fails", async () => {
    const original = "const value = 1;\n";
    const jsTsGateway = featuresGateway({
      formatting: vi.fn(async () => {
        throw new Error("formatter crashed");
      }),
    });
    const deps = makeDeps({
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: runningStatus({ formatting: true }),
      },
      workspaceSettingsRef: {
        current: { ...defaultWorkspaceSettings(), formatOnSave: true },
      },
    });
    const harness = renderPipeline(deps);

    const result = await harness
      .pipeline()
      .formattedContentForSave(editorDocument(`${ROOT}/src/App.ts`, original), ROOT);

    expect(result).toBe(original);
    harness.unmount();
  });

  it("times out a hung formatter, exactly cancels it, and ignores a late edit", async () => {
    vi.useFakeTimers();
    try {
      const path = `${ROOT}/src/App.ts`;
      const original = "const value=1;\n";
      const formatted = "const value = 1;\n";
      const pending = deferred<LanguageServerTextEdit[]>(7, 31);
      const cancelRequest = vi.fn(async () => undefined);
      const jsTsGateway = featuresGateway({
        identifiedRequests: identifiedRequests(cancelRequest),
      });
      vi.mocked(jsTsGateway.formatting).mockReturnValueOnce(pending.promise);
      const harness = renderPipeline(
        makeDeps({
          javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
          javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
            current: runningStatus({ formatting: true }),
          },
          workspaceSettingsRef: {
            current: { ...defaultWorkspaceSettings(), formatOnSave: true },
          },
        }),
      );

      const result = harness
        .pipeline()
        .formattedContentForSave(editorDocument(path, original), ROOT);
      await act(async () => undefined);
      await act(async () => vi.advanceTimersByTimeAsync(2_500));

      await expect(result).resolves.toBe(original);
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 7, 31);

      pending.resolve([fullTextEdit(original, formatted)]);
      await act(async () => undefined);
      await expect(result).resolves.toBe(original);
      expect(cancelRequest).toHaveBeenCalledTimes(1);
      harness.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns original content when the JS/TS session becomes inactive after await", async () => {
    let active = true;
    const original = "const value = 1;\n";
    const formatted = "const value = 2;\n";
    const jsTsGateway = featuresGateway({
      formatting: vi.fn(async () => {
        active = false;
        return [fullTextEdit(original, formatted)];
      }),
    });
    const deps = makeDeps({
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(() => active),
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: runningStatus({ formatting: true }),
      },
      workspaceSettingsRef: {
        current: { ...defaultWorkspaceSettings(), formatOnSave: true },
      },
    });
    const harness = renderPipeline(deps);

    const result = await harness
      .pipeline()
      .formattedContentForSave(editorDocument(`${ROOT}/src/App.ts`, original), ROOT);

    expect(result).toBe(original);
    harness.unmount();
  });

  it("optimizes PHP imports only when enabled for a PHP document in a PHP workspace", () => {
    const source = [
      "<?php",
      "",
      "namespace App;",
      "",
      "use App\\Services\\UsedService;",
      "use App\\Services\\UnusedService;",
      "",
      "class Foo",
      "{",
      "    public function bar(UsedService $service): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");
    const optimized = [
      "<?php",
      "",
      "namespace App;",
      "",
      "use App\\Services\\UsedService;",
      "",
      "class Foo",
      "{",
      "    public function bar(UsedService $service): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");
    const phpDocument = editorDocument(`${ROOT}/src/Foo.php`, source, "php");
    const tsDocument = editorDocument(`${ROOT}/src/Foo.ts`, source, "typescript");
    const disabled = renderPipeline(makeDeps({ hasPhpWorkspace: true }));
    const noPhpWorkspace = renderPipeline(
      makeDeps({
        workspaceSettingsRef: {
          current: { ...defaultWorkspaceSettings(), optimizeImportsOnSave: true },
        },
      }),
    );
    const enabled = renderPipeline(
      makeDeps({
        hasPhpWorkspace: true,
        workspaceSettingsRef: {
          current: { ...defaultWorkspaceSettings(), optimizeImportsOnSave: true },
        },
      }),
    );

    expect(disabled.pipeline().optimizedImportsContentForSave(phpDocument, source)).toBe(source);
    expect(noPhpWorkspace.pipeline().optimizedImportsContentForSave(phpDocument, source)).toBe(
      source,
    );
    expect(enabled.pipeline().optimizedImportsContentForSave(tsDocument, source)).toBe(source);
    expect(enabled.pipeline().optimizedImportsContentForSave(phpDocument, source)).toBe(optimized);

    disabled.unmount();
    noPhpWorkspace.unmount();
    enabled.unmount();
  });

  it("uses owner-explicit settings and PHP capability over opposite active refs", () => {
    const source = [
      "<?php",
      "namespace App;",
      "use App\\Used;",
      "use App\\Unused;",
      "class Example { public function run(Used $used): void {} }",
      "",
    ].join("\n");
    const item = editorDocument(`${ROOT}/Example.php`, source, "php");
    const owner = createWorkspaceRuntimeOwner("inactive-owner", ROOT);
    const activeEnabled = renderPipeline(
      makeDeps({
        hasPhpWorkspace: true,
        workspaceSettingsRef: {
          current: {
            ...defaultWorkspaceSettings(),
            optimizeImportsOnSave: true,
          },
        },
      }),
    );
    const activeDisabled = renderPipeline(makeDeps());
    const context = (hasPhpWorkspace: boolean, optimizeImportsOnSave: boolean) => ({
      canUseLanguageServerDocument: true,
      hasPhpWorkspace,
      javaScriptTypeScriptRuntimeStatus: null,
      javaScriptTypeScriptRuntimeStatusRoot: ROOT,
      owner,
      phpRuntimeStatus: null,
      phpRuntimeStatusRoot: ROOT,
      settings: {
        ...defaultWorkspaceSettings(),
        optimizeImportsOnSave,
      },
    });

    expect(
      activeEnabled
        .pipeline()
        .optimizedImportsContentForOwnerSave(context(false, false), item, source),
    ).toBe(source);
    expect(
      activeDisabled
        .pipeline()
        .optimizedImportsContentForOwnerSave(context(true, true), item, source),
    ).not.toContain("use App\\Unused;");

    activeEnabled.unmount();
    activeDisabled.unmount();
  });

  it("skips server transformations for an inactive owner without an open buffer", async () => {
    const phpGateway = featuresGateway();
    const jsTsGateway = featuresGateway();
    const deps = makeDeps({
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      languageServerFeaturesGateway: phpGateway,
    });
    const harness = renderPipeline(deps);
    const owner = createWorkspaceRuntimeOwner("inactive-owner", ROOT);
    const settings = {
      ...defaultWorkspaceSettings(),
      formatOnSave: true,
      javaScriptTypeScriptOrganizeImportsOnSave: true,
      optimizeImportsOnSave: true,
    };
    const context = {
      canUseLanguageServerDocument: false,
      hasPhpWorkspace: true,
      javaScriptTypeScriptRuntimeStatus: runningStatus({ codeAction: true }),
      javaScriptTypeScriptRuntimeStatusRoot: ROOT,
      owner,
      phpRuntimeStatus: runningStatus({ formatting: true }),
      phpRuntimeStatusRoot: ROOT,
      settings,
    };
    const phpSource = [
      "<?php",
      "namespace App;",
      "use App\\Used;",
      "use App\\Unused;",
      "class Example { public function run(Used $used): void {} }",
      "",
    ].join("\n");
    const phpDocument = editorDocument(`${ROOT}/Example.php`, phpSource, "php");
    const tsSource = "import { value } from './value';\n";
    const tsDocument = editorDocument(`${ROOT}/Example.ts`, tsSource);

    await expect(
      harness.pipeline().formattedContentForOwnerSave(context, phpDocument, ROOT),
    ).resolves.toBe(phpSource);
    await expect(
      harness.pipeline().organizedImportsContentForOwnerSave(context, tsDocument, tsSource, ROOT),
    ).resolves.toBe(tsSource);
    expect(
      harness.pipeline().optimizedImportsContentForOwnerSave(context, phpDocument, phpSource),
    ).not.toContain("use App\\Unused;");
    expect(deps.flushPendingDocumentChangeForRoot).not.toHaveBeenCalled();
    expect(deps.flushPendingJavaScriptTypeScriptDocumentChangeForRoot).not.toHaveBeenCalled();
    expect(phpGateway.formatting).not.toHaveBeenCalled();
    expect(jsTsGateway.codeActions).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("resolves data-only JS/TS source actions and applies their edits", async () => {
    const events: string[] = [];
    const path = `${ROOT}/src/App.ts`;
    const original = "import { b } from './b';\nimport { a } from './a';\n";
    const organized = "import { a } from './a';\nimport { b } from './b';\n";
    const pendingAction = dataOnlyAction();
    const jsTsGateway = featuresGateway({
      codeActions: vi.fn(async (rootPath, requestedPath) => {
        events.push(`codeActions:${rootPath}:${requestedPath}`);
        return [pendingAction];
      }),
      resolveCodeAction: vi.fn(async () =>
        action(path, original, organized, "source.organizeImports"),
      ),
    });
    const deps = makeDeps({
      flushPendingJavaScriptTypeScriptDocumentChangeForRoot: vi.fn(
        async (rootPath, requestedPath) => {
          events.push(`flush:${rootPath}:${requestedPath}`);
        },
      ),
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: runningStatus({ codeAction: true }),
      },
      workspaceSettingsRef: {
        current: {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptOrganizeImportsOnSave: true,
        },
      },
    });
    const harness = renderPipeline(deps);

    const result = await harness
      .pipeline()
      .organizedImportsContentForSave(editorDocument(path, original), original, ROOT);

    expect(jsTsGateway.resolveCodeAction).toHaveBeenCalledWith(ROOT, pendingAction, 7);
    expect(events).toEqual([`flush:${ROOT}:${path}`, `codeActions:${ROOT}:${path}`]);
    expect(result).toBe(organized);
    harness.unmount();
  });

  it("runs JS/TS source actions in order, ignores command-only actions, and swallows failures", async () => {
    const path = `${ROOT}/src/App.ts`;
    const original = "import { b } from './b';\nimport { a } from './a';\n";
    const sorted = "import { a } from './a';\nimport { b } from './b';\n";
    const requestedKinds: Array<string | null> = [];
    const jsTsGateway = featuresGateway({
      codeActions: vi.fn(
        async (
          _root: string,
          _path: string,
          _range: LanguageServerRange,
          context: LanguageServerCodeActionContext,
        ) => {
          const kind = context.only?.[0] ?? null;
          requestedKinds.push(kind);

          if (kind === "source.addMissingImports.ts") {
            throw new Error("add missing failed");
          }

          if (kind === "source.organizeImports") {
            return [commandOnlyAction(kind)];
          }

          if (kind === "source.sortImports.ts") {
            return [action(path, original, sorted, kind)];
          }

          return [];
        },
      ),
    });
    const deps = makeDeps({
      javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: runningStatus({ codeAction: true }),
      },
      workspaceSettingsRef: {
        current: {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptAddMissingImportsOnSave: true,
          javaScriptTypeScriptOrganizeImportsOnSave: true,
          javaScriptTypeScriptRemoveUnusedOnSave: true,
        },
      },
    });
    const harness = renderPipeline(deps);

    const result = await harness
      .pipeline()
      .organizedImportsContentForSave(editorDocument(path, original), original, ROOT);

    expect(requestedKinds).toEqual([
      "source.addMissingImports.ts",
      "source.organizeImports",
      "source.sortImports.ts",
    ]);
    expect(jsTsGateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(result).toBe(sorted);
    harness.unmount();
  });

  it("times out a hung source action, cancels its exact backend request, and ignores its late edit", async () => {
    vi.useFakeTimers();
    try {
      const path = `${ROOT}/src/App.ts`;
      const original = "import { b } from './b';\nimport { a } from './a';\n";
      const organized = "import { a } from './a';\nimport { b } from './b';\n";
      const pending = deferred<LanguageServerCodeAction[]>(7, 41);
      const cancelRequest = vi.fn(async () => undefined);
      const jsTsGateway = featuresGateway({
        identifiedRequests: identifiedRequests(cancelRequest),
      });
      vi.mocked(jsTsGateway.codeActions).mockReturnValueOnce(pending.promise);
      const harness = renderPipeline(
        makeDeps({
          javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
          javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
            current: runningStatus({ codeAction: true }),
          },
          workspaceSettingsRef: {
            current: {
              ...defaultWorkspaceSettings(),
              javaScriptTypeScriptOrganizeImportsOnSave: true,
            },
          },
        }),
      );

      const result = harness
        .pipeline()
        .organizedImportsContentForSave(editorDocument(path, original), original, ROOT);
      await act(async () => undefined);
      await act(async () => vi.advanceTimersByTimeAsync(2_500));

      await expect(result).resolves.toBe(original);
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 7, 41);

      pending.resolve([action(path, original, organized)]);
      await act(async () => undefined);
      await expect(result).resolves.toBe(original);
      expect(cancelRequest).toHaveBeenCalledTimes(1);
      harness.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("immediately rejects and cancels a foreign-session source action receipt", async () => {
    const path = `${ROOT}/src/App.ts`;
    const original = "import { b } from './b';\n";
    const foreign = deferred<LanguageServerCodeAction[]>(99, 46);
    const cancelRequest = vi.fn(async () => undefined);
    const jsTsGateway = featuresGateway({
      identifiedRequests: identifiedRequests(cancelRequest),
    });
    vi.mocked(jsTsGateway.codeActions).mockReturnValueOnce(foreign.promise);
    const harness = renderPipeline(
      makeDeps({
        javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
        javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
          current: runningStatus({ codeAction: true }, 7),
        },
        workspaceSettingsRef: {
          current: {
            ...defaultWorkspaceSettings(),
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        },
      }),
    );

    await expect(
      harness
        .pipeline()
        .organizedImportsContentForSave(editorDocument(path, original), original, ROOT),
    ).resolves.toBe(original);
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 99, 46);
    harness.unmount();
    expect(cancelRequest).toHaveBeenCalledTimes(1);
  });

  it("times out and exactly cancels a hung source action resolve request", async () => {
    vi.useFakeTimers();
    try {
      const path = `${ROOT}/src/App.ts`;
      const original = "import { b } from './b';\n";
      const resolvePending = deferred<LanguageServerCodeAction>(7, 52);
      const cancelRequest = vi.fn(async () => undefined);
      const jsTsGateway = featuresGateway({
        identifiedRequests: identifiedRequests(cancelRequest),
      });
      vi.mocked(jsTsGateway.codeActions).mockReturnValueOnce(
        identified(Promise.resolve([dataOnlyAction()]), 7, 51),
      );
      vi.mocked(jsTsGateway.resolveCodeAction).mockReturnValueOnce(resolvePending.promise);
      const harness = renderPipeline(
        makeDeps({
          javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
          javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
            current: runningStatus({ codeAction: true }),
          },
          workspaceSettingsRef: {
            current: {
              ...defaultWorkspaceSettings(),
              javaScriptTypeScriptOrganizeImportsOnSave: true,
            },
          },
        }),
      );

      const result = harness
        .pipeline()
        .organizedImportsContentForSave(editorDocument(path, original), original, ROOT);
      await act(async () => undefined);
      await act(async () => vi.advanceTimersByTimeAsync(2_500));

      await expect(result).resolves.toBe(original);
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 7, 52);
      harness.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a stale save generation and only applies the latest same-document result", async () => {
    const path = `${ROOT}/src/App.ts`;
    const original = "import { b } from './b';\nimport { a } from './a';\n";
    const firstPending = deferred<LanguageServerCodeAction[]>(7, 61);
    const latest = "import { a } from './a';\nimport { b } from './b';\n";
    const cancelRequest = vi.fn(async () => undefined);
    const jsTsGateway = featuresGateway({
      identifiedRequests: identifiedRequests(cancelRequest),
    });
    vi.mocked(jsTsGateway.codeActions)
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(identified(Promise.resolve([action(path, original, latest)]), 7, 62));
    const harness = renderPipeline(
      makeDeps({
        javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
        javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
          current: runningStatus({ codeAction: true }),
        },
        workspaceSettingsRef: {
          current: {
            ...defaultWorkspaceSettings(),
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        },
      }),
    );
    const document = editorDocument(path, original);

    const staleResult = harness.pipeline().organizedImportsContentForSave(document, original, ROOT);
    await act(async () => undefined);
    const latestResult = harness
      .pipeline()
      .organizedImportsContentForSave(document, original, ROOT);

    await expect(staleResult).resolves.toBe(original);
    await expect(latestResult).resolves.toBe(latest);
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 7, 61);
    harness.unmount();
  });

  it("fences the superseded A generation across an independent A-B-A owner sequence", async () => {
    const path = `${ROOT}/src/App.ts`;
    const original = "import { b } from './b';\nimport { a } from './a';\n";
    const ownerA = createWorkspaceRuntimeOwner("owner-a", ROOT);
    const ownerB = createWorkspaceRuntimeOwner("owner-b", ROOT);
    const firstA = deferred<LanguageServerCodeAction[]>(7, 71);
    const pendingB = deferred<LanguageServerCodeAction[]>(7, 72);
    const finalAContent = "import { a } from './a';\nimport { b } from './b';\n";
    const cancelRequest = vi.fn(async () => undefined);
    const jsTsGateway = featuresGateway({
      identifiedRequests: identifiedRequests(cancelRequest),
    });
    vi.mocked(jsTsGateway.codeActions)
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(pendingB.promise)
      .mockReturnValueOnce(
        identified(Promise.resolve([action(path, original, finalAContent)]), 7, 73),
      );
    const harness = renderPipeline(
      makeDeps({
        javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
      }),
    );
    const context = (owner: ReturnType<typeof createWorkspaceRuntimeOwner>) => ({
      canUseLanguageServerDocument: true,
      hasPhpWorkspace: false,
      javaScriptTypeScriptRuntimeStatus: runningStatus({ codeAction: true }),
      javaScriptTypeScriptRuntimeStatusRoot: ROOT,
      owner,
      phpRuntimeStatus: null,
      phpRuntimeStatusRoot: ROOT,
      settings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptOrganizeImportsOnSave: true,
      },
    });
    const document = editorDocument(path, original);

    const staleA = harness
      .pipeline()
      .organizedImportsContentForOwnerSave(context(ownerA), document, original, ROOT);
    await act(async () => undefined);
    const staleB = harness
      .pipeline()
      .organizedImportsContentForOwnerSave(context(ownerB), document, original, ROOT);
    await act(async () => undefined);
    const finalA = harness
      .pipeline()
      .organizedImportsContentForOwnerSave(context(ownerA), document, original, ROOT);
    pendingB.resolve([]);

    await expect(staleA).resolves.toBe(original);
    await expect(staleB).resolves.toBe(original);
    await expect(finalA).resolves.toBe(finalAContent);
    expect(cancelRequest).toHaveBeenNthCalledWith(1, ROOT, 7, 71);
    expect(cancelRequest).toHaveBeenNthCalledWith(2, ROOT, 7, 72);
    expect(cancelRequest).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("keeps source action requests for different documents independent", async () => {
    const firstPath = `${ROOT}/src/first.ts`;
    const secondPath = `${ROOT}/src/second.ts`;
    const firstOriginal = "import { b } from './b';\n";
    const secondOriginal = "import { d } from './d';\n";
    const firstOrganized = "import { a } from './a';\n";
    const secondOrganized = "import { c } from './c';\n";
    const firstPending = deferred<LanguageServerCodeAction[]>(7, 91);
    const cancelRequest = vi.fn(async () => undefined);
    const jsTsGateway = featuresGateway({
      identifiedRequests: identifiedRequests(cancelRequest),
    });
    vi.mocked(jsTsGateway.codeActions)
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(
        identified(Promise.resolve([action(secondPath, secondOriginal, secondOrganized)]), 7, 92),
      );
    const harness = renderPipeline(
      makeDeps({
        javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
        javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
          current: runningStatus({ codeAction: true }),
        },
        workspaceSettingsRef: {
          current: {
            ...defaultWorkspaceSettings(),
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        },
      }),
    );

    const firstResult = harness
      .pipeline()
      .organizedImportsContentForSave(
        editorDocument(firstPath, firstOriginal),
        firstOriginal,
        ROOT,
      );
    await act(async () => undefined);
    const secondResult = harness
      .pipeline()
      .organizedImportsContentForSave(
        editorDocument(secondPath, secondOriginal),
        secondOriginal,
        ROOT,
      );
    firstPending.resolve([action(firstPath, firstOriginal, firstOrganized)]);

    await expect(firstResult).resolves.toBe(firstOrganized);
    await expect(secondResult).resolves.toBe(secondOrganized);
    expect(cancelRequest).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("cancels an exact pending source action request on unmount", async () => {
    const path = `${ROOT}/src/App.ts`;
    const original = "import { b } from './b';\n";
    const pending = deferred<LanguageServerCodeAction[]>(7, 81);
    const cancelRequest = vi.fn(async () => undefined);
    const jsTsGateway = featuresGateway({
      identifiedRequests: identifiedRequests(cancelRequest),
    });
    vi.mocked(jsTsGateway.codeActions).mockReturnValueOnce(pending.promise);
    const harness = renderPipeline(
      makeDeps({
        javaScriptTypeScriptLanguageServerFeaturesGateway: jsTsGateway,
        javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
          current: runningStatus({ codeAction: true }),
        },
        workspaceSettingsRef: {
          current: {
            ...defaultWorkspaceSettings(),
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        },
      }),
    );

    const result = harness
      .pipeline()
      .organizedImportsContentForSave(editorDocument(path, original), original, ROOT);
    await act(async () => undefined);
    harness.unmount();

    await expect(result).resolves.toBe(original);
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(ROOT, 7, 81);
  });
});
