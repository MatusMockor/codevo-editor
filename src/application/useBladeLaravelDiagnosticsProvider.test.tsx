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
  usePhpFrameworkActiveDocumentDiagnostics,
  type PhpFrameworkActiveDocumentDiagnosticsHookDependencies,
} from "./usePhpFrameworkActiveDocumentDiagnostics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROOT = "/workspace";
const BLADE_PATH = `${ROOT}/resources/views/comments/show.blade.php`;
const LATTE_PATH = `${ROOT}/app/UI/Home/default.latte`;
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
function runtimeWithProvider(
  providerId: string | null,
  overrides: Partial<PhpFrameworkRuntimeContext> = {},
): PhpFrameworkRuntimeContext {
  return {
    ...LARAVEL_RUNTIME,
    isLaravel: providerId === "laravel",
    isNette: providerId === "nette",
    profile: providerId === "nette" ? "nette" : "generic",
    hasProvider: (candidateId) => candidateId === providerId,
    ...overrides,
  };
}

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
  overrides: Partial<PhpFrameworkActiveDocumentDiagnosticsHookDependencies> = {},
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

  let deps: PhpFrameworkActiveDocumentDiagnosticsHookDependencies = {
    activeDocument,
    activeDocumentRef,
    collectCompleteLatteTemplateRelativePaths: vi.fn(async () => []),
    collectViewTargets: vi.fn(async () => [viewTarget("dashboard")]),
    currentWorkspaceRootRef,
    frameworkRuntime: LARAVEL_RUNTIME,
    provideLattePresenterLinkDiagnostics: vi.fn(async () => []),
    setFrameworkDiagnosticsByPath: laravelDiagnostics.set,
    workspaceRoot: ROOT,
    ...overrides,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpFrameworkActiveDocumentDiagnosticsHookDependencies;
  }) {
    usePhpFrameworkActiveDocumentDiagnostics(dependencies);
    return null;
  }

  const rerender = async (
    next: Partial<PhpFrameworkActiveDocumentDiagnosticsHookDependencies> = {},
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

describe("usePhpFrameworkActiveDocumentDiagnostics", () => {
  it("activates Laravel Blade diagnostics by provider identity", async () => {
    const harness = renderProvider({
      frameworkRuntime: runtimeWithProvider("laravel", { isLaravel: false }),
    });

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

  it("activates Nette Latte missing-template diagnostics by provider identity", async () => {
    const latteDocument = editorDocument({
      content: "{include 'partials/missing'}\n",
      language: "latte",
      name: "default.latte",
      path: LATTE_PATH,
    });
    const collectCompleteLatteTemplateRelativePaths = vi.fn(async () => [
      "app/UI/Home/default.latte",
    ]);
    const collectViewTargets = vi.fn(async () => [viewTarget("dashboard")]);
    const harness = renderProvider({
      activeDocument: latteDocument,
      activeDocumentRef: ref<EditorDocument | null>(latteDocument),
      collectCompleteLatteTemplateRelativePaths,
      collectViewTargets,
      frameworkRuntime: runtimeWithProvider("nette"),
    });

    await harness.rerender();

    expect(harness.diagnostics.value[LATTE_PATH]).toMatchObject([
      {
        code: "nette.missingTemplate",
        data: {
          kind: "missing-template",
          name: "partials/missing",
          relativePath: "app/UI/Home/partials/missing.latte",
        },
        message: "No Nette Latte template partials/missing was found.",
        severity: "warning",
        source: "Nette",
      },
    ]);
    expect(collectCompleteLatteTemplateRelativePaths).toHaveBeenCalledTimes(1);
    expect(collectViewTargets).not.toHaveBeenCalled();

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

  it.each([
    ["generic", runtimeWithProvider(null)],
    ["Nette", runtimeWithProvider("nette")],
    ["custom", runtimeWithProvider("custom")],
  ])(
    "clears stale diagnostics and stays inert for a %s provider",
    async (_label, frameworkRuntime) => {
      const collectViewTargets = vi.fn(async () => [viewTarget("dashboard")]);
      const harness = renderProvider({
        collectViewTargets,
        frameworkRuntime,
      });
      harness.diagnostics.value = {
        [BLADE_PATH]: [diagnostic()],
      };

      await harness.rerender();

      expect(harness.diagnostics.value).toEqual({});
      expect(collectViewTargets).not.toHaveBeenCalled();

      harness.unmount();
    },
  );

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
