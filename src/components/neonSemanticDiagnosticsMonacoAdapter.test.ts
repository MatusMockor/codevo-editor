import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { NeonSemanticDiagnostic } from "../domain/neonSemanticDiagnostics";
import { provideNeonSemanticDiagnostics } from "../application/neonSemanticDiagnosticsProvider";
import {
  NETTE_NEON_SEMANTIC_MARKER_OWNER,
  registerNeonSemanticDiagnostics,
} from "./neonSemanticDiagnosticsMonacoAdapter";
import type { TemplateLanguageMonacoProviderContext } from "./templateLanguageMonacoTypes";

describe("registerNeonSemanticDiagnostics", () => {
  it("ignores legacy or throwing non-capable Monaco models", () => {
    const missing = fakeModel("/ws/legacy.php", "<?php");
    const throwing = fakeModel("/ws/broken.neon", "services:");
    (missing as { getLanguageId?: () => string }).getLanguageId = undefined;
    throwing.getLanguageId = () => {
      throw new Error("disposed model");
    };
    const harness = fakeMonaco([missing, throwing]);

    expect(() =>
      registerNeonSemanticDiagnostics(
        harness.monaco,
        context(harness, { files: {}, provideSemanticDiagnostics: vi.fn(async () => []) }),
      ),
    ).not.toThrow();
    expect(missing.listenerCount()).toBe(0);
    expect(throwing.listenerCount()).toBe(0);
  });

  it("publishes exact markers from dirty open overlays", async () => {
    const disk = "services:\n  consumer: App\\Consumer(@diskOnly)";
    const overlay = "services:\n  consumer: App\\Consumer(@missing)";
    const model = fakeModel("/ws/config.neon", overlay);
    const harness = fakeMonaco([model]);
    registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, {
        files: { "/ws/config.neon": disk },
        provideSemanticDiagnostics: provideNeonSemanticDiagnostics,
      }),
    );

    await settle();

    expect(lastMarkers(harness, model)).toEqual([
      {
        code: "neon.unresolvedService",
        endColumn: 34,
        endLineNumber: 2,
        message: "Unknown Nette service 'missing'.",
        severity: 4,
        source: "Nette NEON",
        startColumn: 26,
        startLineNumber: 2,
      },
    ]);
  });

  it("clears prior markers when a fresh repository is incomplete", async () => {
    const model = fakeModel("/ws/config.neon", "services:\n  x: App\\X(@missing)");
    const harness = fakeMonaco([model]);
    let incomplete = false;
    registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, {
        files: { "/ws/config.neon": model.getValue() },
        provideSemanticDiagnostics: async (repository) =>
          incomplete ? [] : provideNeonSemanticDiagnostics(repository),
      }),
    );
    await settle();
    expect(lastMarkers(harness, model)).toHaveLength(1);

    incomplete = true;
    model.change(model.getValue());
    await settle();

    expect(lastMarkers(harness, model)).toEqual([]);
  });

  it("drops stale results and lets the latest rapid refresh win", async () => {
    const model = fakeModel("/ws/config.neon", "services:\n  x: App\\X(@first)");
    const harness = fakeMonaco([model]);
    const first = deferred<readonly NeonSemanticDiagnostic[] | null>();
    const second = deferred<readonly NeonSemanticDiagnostic[] | null>();
    const provider = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, { files: {}, provideSemanticDiagnostics: provider }),
    );
    await Promise.resolve();
    model.change("services:\n  x: App\\X(@second)");
    await Promise.resolve();

    second.resolve([diagnostic("/ws/config.neon", "second", 21, 28)]);
    await settle();
    first.resolve([diagnostic("/ws/config.neon", "first", 21, 27)]);
    await settle();

    expect(provider).toHaveBeenCalledTimes(2);
    expect(lastMarkers(harness, model)?.[0]).toMatchObject({
      message: "Unknown Nette service 'second'.",
    });
  });

  it("retains diagnostics for disconnected open include components", async () => {
    const first = fakeModel("/ws/config/first.neon", "services:\n  a: App\\A(@missingA)");
    const second = fakeModel("/ws/config/second.neon", "services:\n  b: App\\B(@missingB)");
    const harness = fakeMonaco([first, second]);
    registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, {
        files: {
          "/ws/config/first.neon": first.getValue(),
          "/ws/config/second.neon": second.getValue(),
        },
        provideSemanticDiagnostics: provideNeonSemanticDiagnostics,
      }),
    );
    await settle();
    expect(lastMarkers(harness, first)?.[0]).toMatchObject({
      message: "Unknown Nette service 'missingA'.",
    });
    expect(lastMarkers(harness, second)?.[0]).toMatchObject({
      message: "Unknown Nette service 'missingB'.",
    });

    second.change("services:\n  b: App\\B(@newMissingB)");
    await settle();

    expect(lastMarkers(harness, first)?.[0]).toMatchObject({
      message: "Unknown Nette service 'missingA'.",
    });
    expect(lastMarkers(harness, second)?.[0]).toMatchObject({
      message: "Unknown Nette service 'newMissingB'.",
    });
  });

  it("deduplicates diagnostics loaded from connected open models", async () => {
    const first = fakeModel(
      "/ws/config/first.neon",
      "includes:\n  - second\nservices:\n  a: App\\A(@missing)",
    );
    const second = fakeModel("/ws/config/second.neon", "services:\n  b: App\\B");
    const harness = fakeMonaco([first, second]);
    const provider = vi.fn(provideNeonSemanticDiagnostics);
    registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, {
        files: {
          "/ws/config/first.neon": first.getValue(),
          "/ws/config/second.neon": second.getValue(),
        },
        provideSemanticDiagnostics: provider,
      }),
    );

    await settle();
    expect(provider).toHaveBeenCalledTimes(2);
    expect(lastMarkers(harness, first)).toHaveLength(1);
    expect(lastMarkers(harness, second)).toEqual([]);
  });

  it("matches and deduplicates Windows diagnostic paths case-insensitively", async () => {
    const model = fakeModel(
      "C:\\Workspace\\Config\\services.neon",
      "services:\n  x: App\\X(@missing)",
    );
    const harness = fakeMonaco([model]);
    const provider = vi.fn(async () => [
      diagnostic("c:/workspace/config/SERVICES.neon", "missing", 21, 29),
      diagnostic("C:\\WORKSPACE\\CONFIG\\services.neon", "missing", 21, 29),
    ]);
    registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, {
        files: {},
        getRoot: () => "C:/Workspace",
        provideSemanticDiagnostics: provider,
      }),
    );

    await settle();

    expect(lastMarkers(harness, model)).toHaveLength(1);
    expect(lastMarkers(harness, model)?.[0]).toMatchObject({
      message: "Unknown Nette service 'missing'.",
    });
  });

  it("clears without loading when the open NEON model cap is exceeded", async () => {
    const models = Array.from({ length: 17 }, (_, index) =>
      fakeModel(`/ws/${index}.neon`, `services:\n  x${index}: App\\X(@missing${index})`),
    );
    const harness = fakeMonaco(models);
    const provider = vi.fn(async () => []);
    registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, { files: {}, provideSemanticDiagnostics: provider }),
    );

    await settle();

    expect(provider).not.toHaveBeenCalled();
    for (const model of models) expect(lastMarkers(harness, model)).toEqual([]);
  });

  it("contains throwing injected ports and clears only the current owner", async () => {
    const model = fakeModel("/ws/config.neon", "services:\n  x: App\\X(@missing)");
    const harness = fakeMonaco([model]);
    const throwing = context(harness, {
      files: {},
      provideSemanticDiagnostics: async () => [],
    });
    throwing.getTemplateLanguageProviders = () => {
      throw new Error("injected failure");
    };

    registerNeonSemanticDiagnostics(harness.monaco, throwing);
    await settle();

    expect(harness.reportError).toHaveBeenCalledWith(new Error("injected failure"));
    expect(lastMarkers(harness, model)).toEqual([]);
  });

  it("contains a throwing repository factory without an unhandled refresh", async () => {
    const model = fakeModel("/ws/config.neon", "services:\n  x: App\\X(@missing)");
    const harness = fakeMonaco([model]);
    const throwing = context(harness, {
      files: {},
      provideSemanticDiagnostics: async () => [],
    });
    throwing.createNeonSemanticDiagnosticsRepository = () => {
      throw new Error("factory failure");
    };

    registerNeonSemanticDiagnostics(harness.monaco, throwing);
    await settle();

    expect(harness.reportError).toHaveBeenCalledWith(new Error("factory failure"));
    expect(lastMarkers(harness, model)).toEqual([]);
  });

  it("contains a rejected provider even when error reporting also throws", async () => {
    const model = fakeModel("/ws/config.neon", "services:\n  x: App\\X(@missing)");
    const harness = fakeMonaco([model]);
    const throwing = context(harness, {
      files: {},
      provideSemanticDiagnostics: async () => {
        throw new Error("provider failure");
      },
    });
    throwing.reportError = () => {
      throw new Error("report failure");
    };

    registerNeonSemanticDiagnostics(harness.monaco, throwing);
    await settle();

    expect(lastMarkers(harness, model)).toEqual([]);
  });

  it("cleans the prior owner on workspace switch and unmount", async () => {
    const model = fakeModel("/ws/config.neon", "services:\n  x: App\\X(@missing)");
    const harness = fakeMonaco([model]);
    let root = "/ws";
    const registration = registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, {
        files: { "/ws/config.neon": model.getValue() },
        getRoot: () => root,
        provideSemanticDiagnostics: provideNeonSemanticDiagnostics,
      }),
    );
    await settle();
    expect(lastMarkers(harness, model)).toHaveLength(1);

    root = "/other";
    model.change(model.getValue());
    expect(lastMarkers(harness, model)).toEqual([]);
    registration.dispose();

    expect(lastMarkers(harness, model)).toEqual([]);
    expect(harness.createListenerCount()).toBe(0);
    expect(model.listenerCount()).toBe(0);
  });

  it("clears markers and releases subscriptions when a model closes", async () => {
    const model = fakeModel("/ws/config.neon", "services:\n  x: App\\X(@missing)");
    const harness = fakeMonaco([model]);
    registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, {
        files: { "/ws/config.neon": model.getValue() },
        provideSemanticDiagnostics: provideNeonSemanticDiagnostics,
      }),
    );
    await settle();

    model.close();

    expect(lastMarkers(harness, model)).toEqual([]);
    expect(model.listenerCount()).toBe(0);
  });

  it("stays marker-free when the Nette diagnostics provider is inactive", async () => {
    const model = fakeModel("/ws/config.neon", "services:\n  x: App\\X(@missing)");
    const harness = fakeMonaco([model]);
    registerNeonSemanticDiagnostics(
      harness.monaco,
      context(harness, { files: {}, provideSemanticDiagnostics: async () => [] }),
    );

    await settle();
    expect(lastMarkers(harness, model)).toEqual([]);
  });
});

function context(
  harness: ReturnType<typeof fakeMonaco>,
  options: {
    files: Readonly<Record<string, string>>;
    getRoot?: () => string | null;
    provideSemanticDiagnostics(
      repository: Parameters<typeof provideNeonSemanticDiagnostics>[0],
    ): Promise<readonly NeonSemanticDiagnostic[] | null>;
  },
): TemplateLanguageMonacoProviderContext {
  return {
    createNeonSemanticDiagnosticsRepository: (request) => ({
      ...request,
      listNeonFiles: async () => Object.keys(options.files),
      readFile: async (path) => options.files[path] ?? null,
    }),
    getActiveDocument: () => null,
    getTemplateLanguageProviders: () => ({
      blade: noopTemplateProvider(),
      latte: { ...noopTemplateProvider(), provideCodeActions: async () => [] },
      neon: {
        provideCompletions: async () => [],
        provideDefinition: async () => false,
        provideSemanticDiagnostics: options.provideSemanticDiagnostics,
      },
    }),
    getWorkspaceRoot: options.getRoot ?? (() => "/ws"),
    reportError: harness.reportError,
  };
}

function noopTemplateProvider() {
  return {
    provideCodeActions: async () => [],
    provideCompletions: async () => [],
    provideDefinition: async () => false,
  };
}

function fakeMonaco(models: ReturnType<typeof fakeModel>[]) {
  const markerCalls: Array<[ReturnType<typeof fakeModel>, string, readonly unknown[]]> = [];
  const createListeners = new Set<(model: Monaco.editor.ITextModel) => void>();
  const reportError = vi.fn();
  const monaco = {
    MarkerSeverity: { Error: 8, Warning: 4 },
    editor: {
      getModels: () => models,
      onDidCreateModel: (listener: (model: Monaco.editor.ITextModel) => void) => {
        createListeners.add(listener);
        return { dispose: () => createListeners.delete(listener) };
      },
      setModelMarkers: (
        model: ReturnType<typeof fakeModel>,
        owner: string,
        markers: readonly unknown[],
      ) => markerCalls.push([model, owner, markers]),
    },
  } as unknown as typeof Monaco;
  return {
    createListenerCount: () => createListeners.size,
    markerCalls,
    monaco,
    reportError,
  };
}

function fakeModel(path: string, initialSource: string) {
  let source = initialSource;
  let version = 1;
  const changeListeners = new Set<() => void>();
  const disposeListeners = new Set<() => void>();
  return {
    change: (next: string) => {
      source = next;
      version += 1;
      for (const listener of changeListeners) listener();
    },
    close: () => {
      for (const listener of [...disposeListeners]) listener();
    },
    getLanguageId: () => "neon",
    getPositionAt: (offset: number) => positionAt(source, offset),
    getValue: () => source,
    getVersionId: () => version,
    listenerCount: () => changeListeners.size + disposeListeners.size,
    onDidChangeContent: (listener: () => void) => {
      changeListeners.add(listener);
      return { dispose: () => changeListeners.delete(listener) };
    },
    onWillDispose: (listener: () => void) => {
      disposeListeners.add(listener);
      return { dispose: () => disposeListeners.delete(listener) };
    },
    uri: { fsPath: path, path },
  } as unknown as Monaco.editor.ITextModel & {
    change(next: string): void;
    close(): void;
    listenerCount(): number;
  };
}

function lastMarkers(
  harness: ReturnType<typeof fakeMonaco>,
  model: ReturnType<typeof fakeModel>,
): readonly any[] | undefined {
  return [...harness.markerCalls]
    .reverse()
    .find(
      ([candidate, owner]) => candidate === model && owner === NETTE_NEON_SEMANTIC_MARKER_OWNER,
    )?.[2] as readonly any[] | undefined;
}

function diagnostic(
  path: string,
  name: string,
  start: number,
  end: number,
): NeonSemanticDiagnostic {
  return {
    code: "neon.unresolvedService",
    message: `Unknown Nette service '${name}'.`,
    path,
    severity: "warning",
    span: { start, end },
  };
}

function positionAt(source: string, offset: number): { column: number; lineNumber: number } {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { column: offset - lineStart + 1, lineNumber: before.split("\n").length };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
