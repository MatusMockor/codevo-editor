// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { FileEntry, TextSearchResult } from "../domain/workspace";
import {
  useBladeIntelligence,
  type BladeIntelligence,
  type BladeIntelligenceDependencies,
} from "./useBladeIntelligence";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/ws";
const PROVIDERS = [phpLaravelFrameworkProvider];
const LARAVEL_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: ["laravel"],
  profile: "laravel",
  providers: PROVIDERS,
});
const GENERIC_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: [],
  profile: "generic",
  providers: [],
});
const VIEW_PATH = `${ROOT}/resources/views/invoices/show.blade.php`;
const INVOICE_CONTROLLER_PATH = `${ROOT}/app/Http/Controllers/InvoiceController.php`;

const invoiceControllerSource = `<?php
use App\\Models\\Invoice;

class InvoiceController
{
    public function show(): mixed
    {
        $invoice = Invoice::findOrFail(1);

        return view('invoices.show', ['invoice' => $invoice]);
    }
}
`;

function textResult(path: string): TextSearchResult {
  return {
    path,
    relativePath: path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path,
    lineNumber: 1,
    column: 1,
    lineText: "",
  };
}

function fileEntry(path: string, kind: FileEntry["kind"]): FileEntry {
  return { name: path.split("/").pop() ?? path, path, kind };
}

function relativeWorkspacePath(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function positionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, offset);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: offset - lineStart + 1, lineNumber };
}

function makeDeps(
  overrides: Partial<BladeIntelligenceDependencies> = {},
): BladeIntelligenceDependencies {
  return {
    activeDocument: { content: "", path: VIEW_PATH },
    currentWorkspaceRootRef: { current: ROOT },
    frameworkIntelligence: LARAVEL_FRAMEWORK,
    workspaceRoot: ROOT,
    textSearch: { searchText: vi.fn(async () => [] as TextSearchResult[]) },
    workspaceFiles: {
      readDirectory: vi.fn(async () => {
        throw new Error("no directory");
      }),
    },
    readNavigationFileContent: vi.fn(async () => {
      throw new Error("missing file");
    }),
    relativeWorkspacePath,
    openNavigationTarget: vi.fn(async () => true),
    resolvePhpExpressionType: vi.fn(async () => null),
    resolvePhpDeclaredType: (_source, typeName) => typeName,
    resolvePhpClassPropertyOrRelationType: vi.fn(async () => null),
    resolvePhpReceiverMethodCompletions: vi.fn(async () => []),
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => {}),
    collectPhpLaravelViewTargets: vi.fn(async () => []),
    collectPhpLaravelConfigTargets: vi.fn(async () => []),
    collectPhpLaravelNamedRouteTargets: vi.fn(async () => []),
    collectPhpLaravelTranslationTargets: vi.fn(async () => []),
    findPhpLaravelViewTarget: vi.fn(async () => null),
    findPhpLaravelConfigTarget: vi.fn(async () => null),
    findPhpLaravelTranslationTarget: vi.fn(async () => null),
    createMissingBladeViewCodeAction: vi.fn(async () => null),
    openDirectPhpMethodTarget: vi.fn(async () => false),
    openPhpLaravelModelAttributeTarget: vi.fn(async () => false),
    openDirectPhpPropertyTarget: vi.fn(async () => false),
    ...overrides,
  };
}

function renderHook(deps: BladeIntelligenceDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: BladeIntelligence | null } = { api: null };

  function Harness({
    dependencies,
  }: {
    dependencies: BladeIntelligenceDependencies;
  }) {
    captured.api = useBladeIntelligence(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): BladeIntelligence => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    rerender: (next: BladeIntelligenceDependencies) => {
      act(() => {
        root.render(<Harness dependencies={next} />);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function variableCompletionSource(): { position: EditorPosition; source: string } {
  const source = "{{ $ }}";
  const offset = source.indexOf("$") + 1;

  return { position: positionAtOffset(source, offset), source };
}

describe("useBladeIntelligence hook mount", () => {
  it("exposes a stable provider API when the injected deps are unchanged", () => {
    const deps = makeDeps();
    const harness = renderHook(deps);
    const first = harness.api();

    expect(Object.keys(first).sort()).toEqual([
      "invalidateBladeComponentNamesForPath",
      "invalidateBladeViewDataEntriesForPath",
      "provideBladeCodeActions",
      "provideBladeCompletions",
      "provideBladeDefinition",
      "resetBladeIntelligenceCaches",
    ]);
    expect(typeof first.provideBladeCompletions).toBe("function");
    expect(typeof first.provideBladeCodeActions).toBe("function");
    expect(typeof first.provideBladeDefinition).toBe("function");
    expect(typeof first.invalidateBladeViewDataEntriesForPath).toBe("function");
    expect(typeof first.invalidateBladeComponentNamesForPath).toBe("function");
    expect(typeof first.resetBladeIntelligenceCaches).toBe("function");

    harness.rerender(deps);
    expect(harness.api().provideBladeCompletions).toBe(
      first.provideBladeCompletions,
    );

    harness.unmount();
  });
});

describe("useBladeIntelligence completion item contract", () => {
  it("marks Blade directive completions as directive items", async () => {
    const harness = renderHook(makeDeps());
    const source = "@if";

    const completions = await harness.api().provideBladeCompletions(
      source,
      positionAtOffset(source, source.length),
    );

    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "directive", label: "@if" }),
    );
  });

  it("marks PHP-like helper completions as helper items", async () => {
    const harness = renderHook(makeDeps());
    const source = "{{ ro }}";
    const offset = source.indexOf("ro") + "ro".length;

    const completions = await harness.api().provideBladeCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "helper", label: "route" }),
    );
  });

  it("marks Blade view-name completions as view items", async () => {
    const collectPhpLaravelViewTargets = vi.fn(async () => [
      {
        name: "partials.alert",
        path: `${ROOT}/resources/views/partials/alert.blade.php`,
        relativePath: "resources/views/partials/alert.blade.php",
      },
    ]);
    const harness = renderHook(makeDeps({ collectPhpLaravelViewTargets }));
    const source = "@include('partials.a')";
    const offset = source.indexOf("partials.a") + "partials.a".length;

    const completions = await harness.api().provideBladeCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "view", label: "partials.alert" }),
    );
  });
});

describe("useBladeIntelligence view-data completions", () => {
  it("surfaces a view variable from the reverse controller mapping", async () => {
    const searchText = vi.fn(async () => [textResult(INVOICE_CONTROLLER_PATH)]);
    const readNavigationFileContent = vi.fn(async () => invoiceControllerSource);
    const harness = renderHook(
      makeDeps({ textSearch: { searchText }, readNavigationFileContent }),
    );
    const { source, position } = variableCompletionSource();

    const completions = await harness.api().provideBladeCompletions(
      source,
      position,
    );

    expect(completions.map((item) => item.label)).toContain("$invoice");
    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "variable", label: "$invoice" }),
    );
  });

  it("caches the loaded view-data entries across completion calls", async () => {
    const searchText = vi.fn(async () => [textResult(INVOICE_CONTROLLER_PATH)]);
    const readNavigationFileContent = vi.fn(async () => invoiceControllerSource);
    const harness = renderHook(
      makeDeps({ textSearch: { searchText }, readNavigationFileContent }),
    );
    const { source, position } = variableCompletionSource();

    await harness.api().provideBladeCompletions(source, position);
    const callsAfterFirst = searchText.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await harness.api().provideBladeCompletions(source, position);
    expect(searchText.mock.calls.length).toBe(callsAfterFirst);
  });

  it("re-loads after invalidateBladeViewDataEntriesForPath for a PHP file", async () => {
    const searchText = vi.fn(async () => [textResult(INVOICE_CONTROLLER_PATH)]);
    const readNavigationFileContent = vi.fn(async () => invoiceControllerSource);
    const harness = renderHook(
      makeDeps({ textSearch: { searchText }, readNavigationFileContent }),
    );
    const { source, position } = variableCompletionSource();

    await harness.api().provideBladeCompletions(source, position);
    const callsAfterFirst = searchText.mock.calls.length;

    act(() => {
      harness.api().invalidateBladeViewDataEntriesForPath(
        ROOT,
        INVOICE_CONTROLLER_PATH,
      );
    });

    await harness.api().provideBladeCompletions(source, position);
    expect(searchText.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("re-loads after resetBladeIntelligenceCaches", async () => {
    const searchText = vi.fn(async () => [textResult(INVOICE_CONTROLLER_PATH)]);
    const readNavigationFileContent = vi.fn(async () => invoiceControllerSource);
    const harness = renderHook(
      makeDeps({ textSearch: { searchText }, readNavigationFileContent }),
    );
    const { source, position } = variableCompletionSource();

    await harness.api().provideBladeCompletions(source, position);
    const callsAfterFirst = searchText.mock.calls.length;

    act(() => {
      harness.api().resetBladeIntelligenceCaches();
    });

    await harness.api().provideBladeCompletions(source, position);
    expect(searchText.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("drops results when the workspace root changes mid-load (isolation)", async () => {
    const currentWorkspaceRootRef = { current: ROOT };
    const searchText = vi.fn(async () => {
      currentWorkspaceRootRef.current = "/other-root";
      return [textResult(INVOICE_CONTROLLER_PATH)];
    });
    const readNavigationFileContent = vi.fn(async () => invoiceControllerSource);
    const harness = renderHook(
      makeDeps({
        currentWorkspaceRootRef,
        textSearch: { searchText },
        readNavigationFileContent,
      }),
    );
    const { source, position } = variableCompletionSource();

    const completions = await harness.api().provideBladeCompletions(
      source,
      position,
    );

    expect(completions).toEqual([]);
  });
});

describe("useBladeIntelligence foreach + member completions", () => {
  it("lists an enclosing @foreach loop variable", async () => {
    const harness = renderHook(makeDeps());
    const source = "@foreach ($items as $row)\n{{ $ }}\n@endforeach";
    const offset = source.indexOf("{{ $") + "{{ $".length;

    const completions = await harness.api().provideBladeCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((item) => item.label)).toContain("$row");
  });

  it("dispatches typed member completions through the injected PHP resolvers", async () => {
    const searchText = vi.fn(async () => [textResult(INVOICE_CONTROLLER_PATH)]);
    const readNavigationFileContent = vi.fn(async () => invoiceControllerSource);
    const resolvePhpExpressionType = vi.fn(async () => "App\\Models\\Invoice");
    const resolvePhpReceiverMethodCompletions = vi.fn(
      async (): Promise<PhpMethodCompletion[]> => [
        {
          name: "total",
          declaringClassName: "App\\Models\\Invoice",
          parameters: "",
          returnType: "int",
        },
      ],
    );
    const harness = renderHook(
      makeDeps({
        textSearch: { searchText },
        readNavigationFileContent,
        resolvePhpExpressionType,
        resolvePhpReceiverMethodCompletions,
      }),
    );
    const source = "{{ $invoice-> }}";
    const offset = source.indexOf("->") + 2;

    const completions = await harness.api().provideBladeCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(resolvePhpReceiverMethodCompletions).toHaveBeenCalled();
    expect(completions.map((item) => item.label)).toContain("total");
    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "member", label: "total" }),
    );
  });
});

describe("useBladeIntelligence component completions", () => {
  const componentsDir = `${ROOT}/resources/views/components`;

  function componentReadDirectory() {
    return vi.fn(async (path: string): Promise<FileEntry[]> => {
      if (path === componentsDir) {
        return [fileEntry(`${componentsDir}/alert.blade.php`, "file")];
      }

      throw new Error(`no directory: ${path}`);
    });
  }

  it("surfaces workspace component tag names for <x-", async () => {
    const readDirectory = componentReadDirectory();
    const harness = renderHook(
      makeDeps({ workspaceFiles: { readDirectory } }),
    );
    const source = "<x-";
    const offset = source.length;

    const completions = await harness.api().provideBladeCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((item) => item.label)).toContain("alert");
    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "component", label: "alert" }),
    );
  });

  it("caches component names until invalidateBladeComponentNamesForPath", async () => {
    const readDirectory = componentReadDirectory();
    const harness = renderHook(
      makeDeps({ workspaceFiles: { readDirectory } }),
    );
    const source = "<x-";
    const position = positionAtOffset(source, source.length);

    await harness.api().provideBladeCompletions(source, position);
    const callsAfterFirst = readDirectory.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await harness.api().provideBladeCompletions(source, position);
    expect(readDirectory.mock.calls.length).toBe(callsAfterFirst);

    act(() => {
      harness.api().invalidateBladeComponentNamesForPath(
        ROOT,
        `${componentsDir}/alert.blade.php`,
      );
    });

    await harness.api().provideBladeCompletions(source, position);
    expect(readDirectory.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe("useBladeIntelligence definition", () => {
  it("navigates a <x-...> component reference to its blade file", async () => {
    const componentPath = `${ROOT}/resources/views/components/alert.blade.php`;
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path.endsWith("components/alert.blade.php")) {
        return "component body";
      }

      throw new Error(`missing: ${path}`);
    });
    const openNavigationTarget = vi.fn(async () => true);
    const harness = renderHook(
      makeDeps({ readNavigationFileContent, openNavigationTarget }),
    );
    const source = "<x-alert>";
    const offset = source.indexOf("alert");

    const opened = await harness.api().provideBladeDefinition(source, offset);

    expect(opened).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      componentPath,
      { column: 1, lineNumber: 1 },
      "alert",
    );
  });

  it("gates Laravel helper-literal navigation behind the active framework", async () => {
    const collectPhpLaravelNamedRouteTargets = vi.fn(async () => []);
    const harness = renderHook(
      makeDeps({
        frameworkIntelligence: GENERIC_FRAMEWORK,
        collectPhpLaravelNamedRouteTargets,
      }),
    );
    const source = "{{ route('home') }}";
    const offset = source.indexOf("home");

    const opened = await harness.api().provideBladeDefinition(source, offset);

    expect(opened).toBe(false);
    expect(collectPhpLaravelNamedRouteTargets).not.toHaveBeenCalled();
  });
});
