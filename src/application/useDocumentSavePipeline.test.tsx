// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
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

function editorDocument(
  path: string,
  content: string,
  language = "typescript",
): EditorDocument {
  return {
    content,
    language,
    name: path.split("/").pop() ?? path,
    path,
    savedContent: content,
  };
}

function runningStatus(
  capabilities: Partial<
    Extract<LanguageServerRuntimeStatus, { kind: "running" }>["capabilities"]
  >,
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
): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn(async () => []),
    formatting: vi.fn(async () => []),
    resolveCodeAction: vi.fn(async (_root, codeAction) => codeAction),
    ...overrides,
  } as unknown as LanguageServerFeaturesGateway;
}

function makeDeps(
  overrides: Partial<DocumentSavePipelineDependencies> = {},
): DocumentSavePipelineDependencies {
  return {
    flushPendingDocumentChangeForRoot: vi.fn(async () => undefined),
    flushPendingJavaScriptTypeScriptDocumentChangeForRoot: vi.fn(
      async () => undefined,
    ),
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

  function Harness({
    dependencies,
  }: {
    dependencies: DocumentSavePipelineDependencies;
  }) {
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

    const result = await harness
      .pipeline()
      .formattedContentForSave(document, ROOT);

    expect(result).toBe(document.content);
    expect(jsTsGateway.formatting).not.toHaveBeenCalled();
    expect(
      deps.flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
    ).not.toHaveBeenCalled();
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
      flushPendingJavaScriptTypeScriptDocumentChangeForRoot: vi.fn(
        async (rootPath, path) => {
          events.push(`flush:${rootPath}:${path}`);
        },
      ),
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
      .formattedContentForSave(
        editorDocument(`${ROOT}/src/App.ts`, original),
        ROOT,
      );

    expect(events).toEqual([
      `flush:${ROOT}:${ROOT}/src/App.ts`,
      "format",
    ]);
    expect(result).toBe(formatted);
    expect(jsTsGateway.formatting).toHaveBeenCalledWith(
      ROOT,
      `${ROOT}/src/App.ts`,
      expect.objectContaining({ insertSpaces: true, tabSize: 4 }),
    );
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
      flushPendingDocumentChangeForRoot: vi.fn(
        async (rootPath, requestedPath) => {
          events.push(`flush:${rootPath}:${requestedPath}`);
        },
      ),
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

    expect(events).toEqual([
      `flush:${ROOT}:${path}`,
      `format:${ROOT}:${path}`,
    ]);
    expect(result).toBe(formatted);
    harness.unmount();
  });

  it("does not format when the root-aware flush observes a root mismatch", async () => {
    const path = `${ROOT}/src/App.ts`;
    const activeRoot = "/other-workspace";
    const jsTsGateway = featuresGateway();
    let active = true;
    const deps = makeDeps({
      flushPendingJavaScriptTypeScriptDocumentChangeForRoot: vi.fn(
        async (requestedRoot) => {
          active = requestedRoot === activeRoot;
        },
      ),
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(
        () => active,
      ),
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

    const result = await harness
      .pipeline()
      .formattedContentForSave(document, ROOT);

    expect(
      deps.flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
    ).toHaveBeenCalledWith(ROOT, path);
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
      .formattedContentForSave(
        editorDocument(`${ROOT}/src/App.ts`, original),
        ROOT,
      );

    expect(result).toBe(original);
    harness.unmount();
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
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(
        () => active,
      ),
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
      .formattedContentForSave(
        editorDocument(`${ROOT}/src/App.ts`, original),
        ROOT,
      );

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

    expect(
      disabled.pipeline().optimizedImportsContentForSave(phpDocument, source),
    ).toBe(source);
    expect(
      noPhpWorkspace.pipeline().optimizedImportsContentForSave(
        phpDocument,
        source,
      ),
    ).toBe(source);
    expect(
      enabled.pipeline().optimizedImportsContentForSave(tsDocument, source),
    ).toBe(source);
    expect(
      enabled.pipeline().optimizedImportsContentForSave(phpDocument, source),
    ).toBe(optimized);

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
    const activeEnabled = renderPipeline(makeDeps({
      hasPhpWorkspace: true,
      workspaceSettingsRef: {
        current: {
          ...defaultWorkspaceSettings(),
          optimizeImportsOnSave: true,
        },
      },
    }));
    const activeDisabled = renderPipeline(makeDeps());
    const context = (
      hasPhpWorkspace: boolean,
      optimizeImportsOnSave: boolean,
    ) => ({
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

    expect(activeEnabled.pipeline().optimizedImportsContentForOwnerSave(
      context(false, false),
      item,
      source,
    )).toBe(source);
    expect(activeDisabled.pipeline().optimizedImportsContentForOwnerSave(
      context(true, true),
      item,
      source,
    )).not.toContain("use App\\Unused;");

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

    await expect(harness.pipeline().formattedContentForOwnerSave(
      context,
      phpDocument,
      ROOT,
    )).resolves.toBe(phpSource);
    await expect(harness.pipeline().organizedImportsContentForOwnerSave(
      context,
      tsDocument,
      tsSource,
      ROOT,
    )).resolves.toBe(tsSource);
    expect(harness.pipeline().optimizedImportsContentForOwnerSave(
      context,
      phpDocument,
      phpSource,
    )).not.toContain("use App\\Unused;");
    expect(deps.flushPendingDocumentChangeForRoot).not.toHaveBeenCalled();
    expect(deps.flushPendingJavaScriptTypeScriptDocumentChangeForRoot)
      .not.toHaveBeenCalled();
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
      .organizedImportsContentForSave(
        editorDocument(path, original),
        original,
        ROOT,
      );

    expect(jsTsGateway.resolveCodeAction).toHaveBeenCalledWith(
      ROOT,
      pendingAction,
    );
    expect(events).toEqual([
      `flush:${ROOT}:${path}`,
      `codeActions:${ROOT}:${path}`,
    ]);
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
      .organizedImportsContentForSave(
        editorDocument(path, original),
        original,
        ROOT,
      );

    expect(requestedKinds).toEqual([
      "source.addMissingImports.ts",
      "source.organizeImports",
      "source.sortImports.ts",
    ]);
    expect(jsTsGateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(result).toBe(sorted);
    harness.unmount();
  });
});
