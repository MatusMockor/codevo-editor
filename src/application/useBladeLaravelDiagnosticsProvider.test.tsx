// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";
import {
  useBladeLaravelDiagnosticsProvider,
  type BladeLaravelDiagnosticsProviderDependencies,
} from "./useBladeLaravelDiagnosticsProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROOT = "/workspace";
const BLADE_PATH = `${ROOT}/resources/views/comments/show.blade.php`;
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const VIEW_CAPABLE_NON_LARAVEL_RUNTIME: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  isLaravel: false,
  profile: "generic",
};

type MutableRef<T> = { current: T };

function ref<T>(value: T): MutableRef<T> {
  return { current: value };
}

function editorDocument(
  overrides: Partial<EditorDocument> = {},
): EditorDocument {
  return {
    content: "@include('partials.missing')\n",
    language: "blade",
    name: "show.blade.php",
    path: BLADE_PATH,
    savedContent: "",
    ...overrides,
  };
}

function viewTarget(name: string) {
  const relativeViewPath = name.split(".").join("/");

  return {
    name,
    path: `${ROOT}/resources/views/${relativeViewPath}.blade.php`,
    relativePath: `resources/views/${relativeViewPath}.blade.php`,
  };
}

type ViewTarget = ReturnType<typeof viewTarget>;

function diagnostic(
  overrides: Partial<LanguageServerDiagnostic> = {},
): LanguageServerDiagnostic {
  return {
    character: 0,
    line: 0,
    message: "Old diagnostic",
    severity: "warning",
    source: "Laravel",
    ...overrides,
  };
}

function stateHolder<T>(initial: T) {
  const holder = {
    value: initial,
    set: (update: T | ((current: T) => T)) => {
      holder.value =
        typeof update === "function"
          ? (update as (current: T) => T)(holder.value)
          : update;
    },
  };

  return holder;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

function renderProvider(
  overrides: Partial<BladeLaravelDiagnosticsProviderDependencies> = {},
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const activeDocument = overrides.activeDocument ?? editorDocument();
  const activeDocumentRef =
    overrides.activeDocumentRef ?? ref<EditorDocument | null>(activeDocument);
  const currentWorkspaceRootRef =
    overrides.currentWorkspaceRootRef ?? ref<string | null>(ROOT);
  const laravelDiagnostics = stateHolder<
    Record<string, LanguageServerDiagnostic[]>
  >({});

  let deps: BladeLaravelDiagnosticsProviderDependencies = {
    activeDocument,
    activeDocumentRef,
    collectViewTargets: vi.fn(async () => [viewTarget("dashboard")]),
    currentWorkspaceRootRef,
    frameworkRuntime: LARAVEL_RUNTIME,
    setLaravelDiagnosticsByPath: laravelDiagnostics.set,
    workspaceRoot: ROOT,
    ...overrides,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: BladeLaravelDiagnosticsProviderDependencies;
  }) {
    useBladeLaravelDiagnosticsProvider(dependencies);
    return null;
  }

  const rerender = async (
    next: Partial<BladeLaravelDiagnosticsProviderDependencies> = {},
  ) => {
    deps = {
      ...deps,
      ...next,
    };

    await act(async () => {
      root.render(<Harness dependencies={deps} />);
    });
    await flushMicrotasks();
  };

  return {
    activeDocumentRef,
    currentWorkspaceRootRef,
    diagnostics: laravelDiagnostics,
    rerender,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useBladeLaravelDiagnosticsProvider", () => {
  it("reports missing Blade view references for an active Laravel document", async () => {
    const harness = renderProvider();

    await harness.rerender();

    expect(harness.diagnostics.value[BLADE_PATH]).toMatchObject([
      {
        code: "laravel.missingView",
        kind: "missing-view",
        message: "No Laravel view named partials.missing was found.",
        name: "partials.missing",
        severity: "warning",
        source: "Laravel",
      },
    ]);

    harness.unmount();
  });

  it("clears stale diagnostics when the active document is not Blade", async () => {
    const phpDocument = editorDocument({
      content: "<?php\n",
      language: "php",
      name: "show.php",
    });
    const collectViewTargets = vi.fn(async () => [viewTarget("dashboard")]);
    const harness = renderProvider({
      activeDocument: phpDocument,
      activeDocumentRef: ref<EditorDocument | null>(phpDocument),
      collectViewTargets,
    });
    harness.diagnostics.value = {
      [BLADE_PATH]: [diagnostic()],
    };

    await harness.rerender();

    expect(harness.diagnostics.value).toEqual({});
    expect(collectViewTargets).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("clears stale diagnostics when Laravel is inactive even if view support is available", async () => {
    const collectViewTargets = vi.fn(async () => [viewTarget("dashboard")]);
    const harness = renderProvider({
      collectViewTargets,
      frameworkRuntime: VIEW_CAPABLE_NON_LARAVEL_RUNTIME,
    });
    harness.diagnostics.value = {
      [BLADE_PATH]: [diagnostic()],
    };

    await harness.rerender();

    expect(harness.diagnostics.value).toEqual({});
    expect(collectViewTargets).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("ignores stale async diagnostics when active document content changes", async () => {
    const collectRequests: Array<
      ReturnType<typeof deferred<ViewTarget[]>>
    > = [];
    const collectViewTargets = vi.fn(() => {
      const request = deferred<ViewTarget[]>();
      collectRequests.push(request);
      return request.promise;
    });
    const firstDocument = editorDocument({
      content: "@include('partials.missing')\n",
    });
    const activeDocumentRef = ref<EditorDocument | null>(firstDocument);
    const harness = renderProvider({
      activeDocument: firstDocument,
      activeDocumentRef,
      collectViewTargets,
    });

    await harness.rerender();
    const secondDocument = editorDocument({
      content: "@include('dashboard')\n",
    });
    activeDocumentRef.current = secondDocument;
    await harness.rerender({ activeDocument: secondDocument });

    expect(collectRequests).toHaveLength(2);

    await act(async () => {
      collectRequests[1]?.resolve([viewTarget("dashboard")]);
      await collectRequests[1]?.promise;
    });
    await flushMicrotasks();

    expect(harness.diagnostics.value).toEqual({});

    await act(async () => {
      collectRequests[0]?.resolve([viewTarget("dashboard")]);
      await collectRequests[0]?.promise;
    });
    await flushMicrotasks();

    expect(harness.diagnostics.value).toEqual({});

    harness.unmount();
  });
});
