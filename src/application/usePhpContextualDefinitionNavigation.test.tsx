// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import {
  goToPhpFrameworkIdentifierDefinition,
} from "./phpFrameworkIdentifierDefinitionNavigation";
import {
  createPhpLaravelIdentifierDefinitionNavigationAdapter,
  type PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
} from "./phpLaravelIdentifierDefinitionNavigationAdapter";
import {
  usePhpContextualDefinitionNavigation,
  type PhpContextualDefinitionNavigation,
  type PhpContextualDefinitionNavigationDependencies,
} from "./usePhpContextualDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

function positionAfter(source: string, needle: string): EditorPosition {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing needle ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split(/\r?\n/);

  return {
    column: lines[lines.length - 1].length,
    lineNumber: lines.length,
  };
}

function makeDeps(
  overrides: Partial<PhpContextualDefinitionNavigationDependencies> = {},
): PhpContextualDefinitionNavigationDependencies {
  const falseHandler = vi.fn(async () => false);

  return {
    activeDocument: {
      content: "<?php $service->run();",
      language: "php",
      name: "Controller.php",
      path: `${ROOT}/app/Controller.php`,
      savedContent: "",
    },
    activeEditorPositionRef: { current: { column: 18, lineNumber: 1 } },
    goToPhpFrameworkIdentifierDefinition: vi.fn(async () => false),
    goToPhpClassConstantDefinition: falseHandler,
    goToPhpClassIdentifierDefinition: vi.fn(async () => false),
    goToPhpMemberPropertyDefinition: falseHandler,
    goToPhpMethodCallDefinition: falseHandler,
    goToPhpStaticMethodCallDefinition: falseHandler,
    providers: [phpLaravelFrameworkProvider],
    ...overrides,
  };
}

function makeFrameworkIdentifierDeps(
  activeDocument: EditorDocument,
  overrides: Partial<PhpLaravelIdentifierDefinitionNavigationAdapterDependencies> = {},
): PhpLaravelIdentifierDefinitionNavigationAdapterDependencies {
  const falseHandler = vi.fn(async () => false);

  return {
    activeDocument,
    goToPhpFrameworkLiteralDefinition: falseHandler,
    goToPhpFrameworkAuthorizationAbilityDefinition: falseHandler,
    goToPhpFrameworkMiddlewareAliasDefinition: falseHandler,
    goToPhpLaravelRelationStringDefinition: falseHandler,
    openDirectPhpMethodTarget: vi.fn(async () => false),
    ...overrides,
  };
}

function renderHook(deps: PhpContextualDefinitionNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpContextualDefinitionNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpContextualDefinitionNavigationDependencies;
  }) {
    captured.api = usePhpContextualDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpContextualDefinitionNavigation => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpContextualDefinitionNavigation", () => {
  it.each([
    {
      dependency: "goToPhpMethodCallDefinition",
      kind: "methodCall",
      needle: "run",
      source: "<?php $service->run();",
    },
    {
      dependency: "goToPhpMemberPropertyDefinition",
      kind: "memberPropertyAccess",
      needle: "name",
      source: "<?php $service->name;",
    },
    {
      dependency: "goToPhpStaticMethodCallDefinition",
      kind: "staticMethodCall",
      needle: "run",
      source: "<?php ReportService::run();",
    },
    {
      dependency: "goToPhpClassConstantDefinition",
      kind: "classConstant",
      needle: "STATUS",
      source: "<?php ReportService::STATUS;",
    },
    {
      dependency: "goToPhpFrameworkIdentifierDefinition",
      kind: "laravelNamedRouteString",
      needle: "dashboard",
      source: "<?php route('dashboard');",
    },
  ] as const)(
    "forwards the navigation request to $kind handlers",
    async ({ dependency, kind, needle, source }) => {
      const handler = vi.fn(async () => true);
      const request = { canNavigate: vi.fn(() => true) };
      const deps = makeDeps({
        activeDocument: {
          content: source,
          language: "php",
          name: "Controller.php",
          path: `${ROOT}/app/Controller.php`,
          savedContent: "",
        },
        activeEditorPositionRef: { current: positionAfter(source, needle) },
        [dependency]: handler,
      });
      const harness = renderHook(deps);

      await expect(
        harness.api().goToContextualPhpDefinition(request),
      ).resolves.toBe(true);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind }),
        request,
      );

      harness.unmount();
    },
  );

  it("forwards the navigation request through framework and class fallback", async () => {
    const source = "<?php new ReportService();";
    const request = { canNavigate: vi.fn(() => true) };
    const goToPhpFrameworkIdentifierDefinition = vi.fn(async () => false);
    const goToPhpClassIdentifierDefinition = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "Controller.php",
        path: `${ROOT}/app/Controller.php`,
        savedContent: "",
      },
      activeEditorPositionRef: {
        current: positionAfter(source, "ReportService"),
      },
      goToPhpClassIdentifierDefinition,
      goToPhpFrameworkIdentifierDefinition,
    });
    const harness = renderHook(deps);

    await expect(
      harness.api().goToContextualPhpDefinition(request),
    ).resolves.toBe(true);
    expect(goToPhpFrameworkIdentifierDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "classIdentifier" }),
      request,
    );
    expect(goToPhpClassIdentifierDefinition).toHaveBeenCalledWith(
      "ReportService",
      request,
    );

    harness.unmount();
  });

  it("drops a delegated result after same-root request replacement", async () => {
    const result = deferred<boolean>();
    let requestActive = true;
    const request = { canNavigate: () => requestActive };
    const goToPhpMethodCallDefinition = vi.fn(() => result.promise);
    const harness = renderHook(makeDeps({ goToPhpMethodCallDefinition }));
    const navigationPromise = harness
      .api()
      .goToContextualPhpDefinition(request);

    requestActive = false;
    result.resolve(true);

    await expect(navigationPromise).resolves.toBe(false);
    expect(goToPhpMethodCallDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "methodCall" }),
      request,
    );

    harness.unmount();
  });

  it("delegates PHP method calls to the method-call strategy", async () => {
    const goToPhpMethodCallDefinition = vi.fn(async () => true);
    const deps = makeDeps({ goToPhpMethodCallDefinition });
    const harness = renderHook(deps);

    const handled = await harness.api().goToContextualPhpDefinition();

    expect(handled).toBe(true);
    expect(goToPhpMethodCallDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "methodCall",
        methodName: "run",
      }),
    );

    harness.unmount();
  });

  it("delegates class identifiers to deterministic class navigation", async () => {
    const source = `<?php
namespace App;

new ReportService();`;
    const goToPhpClassIdentifierDefinition = vi.fn(async () => true);
    const goToPhpFrameworkIdentifierDefinition = vi.fn(async () => false);
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "Controller.php",
        path: `${ROOT}/app/Controller.php`,
        savedContent: "",
      },
      activeEditorPositionRef: { current: positionAfter(source, "Report") },
      goToPhpFrameworkIdentifierDefinition,
      goToPhpClassIdentifierDefinition,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToContextualPhpDefinition();

    expect(handled).toBe(true);
    expect(goToPhpFrameworkIdentifierDefinition).toHaveBeenCalledWith({
      kind: "classIdentifier",
      name: "ReportService",
    });
    expect(goToPhpClassIdentifierDefinition).toHaveBeenCalledWith(
      "ReportService",
    );

    harness.unmount();
  });

  it("falls back to opening the controller class for missing route action methods", async () => {
    const source = `<?php
use App\\Http\\Controllers\\ReportController;

Route::get('/reports', [ReportController::class, 'store']);`;
    const activeDocument: EditorDocument = {
      content: source,
      language: "php",
      name: "web.php",
      path: `${ROOT}/routes/web.php`,
      savedContent: "",
    };
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpClassTarget = vi.fn(async () => true);
    const goToPhpFrameworkIdentifierDefinitionHandler = vi.fn((context) =>
      goToPhpFrameworkIdentifierDefinition(context, {
        adapters: [
          createPhpLaravelIdentifierDefinitionNavigationAdapter(
            makeFrameworkIdentifierDeps(activeDocument, {
              openDirectPhpMethodTarget,
              openPhpClassTarget,
            }),
          ),
        ],
      }),
    );
    const deps = makeDeps({
      activeDocument,
      activeEditorPositionRef: { current: positionAfter(source, "sto") },
      goToPhpFrameworkIdentifierDefinition:
        goToPhpFrameworkIdentifierDefinitionHandler,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToContextualPhpDefinition();

    expect(handled).toBe(true);
    expect(goToPhpFrameworkIdentifierDefinitionHandler).toHaveBeenCalledWith({
      className: "ReportController",
      kind: "laravelRouteActionMethod",
      methodName: "store",
    });
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\ReportController",
      "store",
    );
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\ReportController",
      "ReportController",
    );

    harness.unmount();
  });

  it("delegates non-literal Laravel contexts to the framework identifier strategy", async () => {
    const source = "<?php Cache::store('redis')->get('reports');";
    const goToPhpFrameworkIdentifierDefinitionHandler = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "Controller.php",
        path: `${ROOT}/app/Controller.php`,
        savedContent: "",
      },
      activeEditorPositionRef: { current: positionAfter(source, "red") },
      goToPhpFrameworkIdentifierDefinition:
        goToPhpFrameworkIdentifierDefinitionHandler,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToContextualPhpDefinition();

    expect(handled).toBe(true);
    expect(goToPhpFrameworkIdentifierDefinitionHandler).toHaveBeenCalledWith({
      kind: "laravelCacheStoreString",
      storeName: "redis",
    });

    harness.unmount();
  });

  it("delegates provider-backed Laravel literal contexts to the framework identifier strategy", async () => {
    const cases = [
      {
        expected: { kind: "laravelNamedRouteString", routeName: "dashboard" },
        needle: "dash",
        source: "<?php route('dashboard');",
      },
      {
        expected: { kind: "laravelNamedRouteString", routeName: "dashboard" },
        needle: "dash",
        source: "<?php to_route('dashboard');",
      },
      {
        expected: { configKey: "app.name", kind: "laravelConfigString" },
        needle: "app",
        source: "<?php config('app.name');",
      },
      {
        expected: { configKey: "app.name", kind: "laravelConfigString" },
        needle: "app",
        source: "<?php Config::string('app.name');",
      },
      {
        expected: { configKey: "app.name", kind: "laravelConfigString" },
        needle: "app",
        source: "<?php config()->get('app.name');",
      },
      {
        expected: { envName: "APP_URL", kind: "laravelEnvString" },
        needle: "APP",
        source: "<?php env('APP_URL');",
      },
      {
        expected: {
          kind: "laravelTranslationString",
          translationKey: "messages.welcome",
        },
        needle: "messages",
        source: "<?php __('messages.welcome');",
      },
      {
        expected: {
          kind: "laravelTranslationString",
          translationKey: "messages.welcome",
        },
        needle: "messages",
        source: "<?php Lang::get('messages.welcome');",
      },
      {
        expected: { kind: "laravelViewString", viewName: "dashboard.index" },
        needle: "dashboard",
        source: "<?php view('dashboard.index');",
      },
      {
        expected: { kind: "laravelViewString", viewName: "dashboard.index" },
        needle: "dashboard",
        source: "<?php View::make('dashboard.index');",
      },
      {
        expected: { kind: "laravelViewString", viewName: "dashboard.index" },
        needle: "dashboard.index",
        source: "<?php Route::view('/dashboard', 'dashboard.index');",
      },
    ] as const;

    for (const testCase of cases) {
      const goToPhpFrameworkIdentifierDefinitionHandler = vi.fn(
        async () => true,
      );
      const deps = makeDeps({
        activeDocument: {
          content: testCase.source,
          language: "php",
          name: "Controller.php",
          path: `${ROOT}/app/Controller.php`,
          savedContent: "",
        },
        activeEditorPositionRef: {
          current: positionAfter(testCase.source, testCase.needle),
        },
        goToPhpFrameworkIdentifierDefinition:
          goToPhpFrameworkIdentifierDefinitionHandler,
      });
      const harness = renderHook(deps);

      const handled = await harness.api().goToContextualPhpDefinition();

      expect(handled, testCase.source).toBe(true);
      expect(goToPhpFrameworkIdentifierDefinitionHandler).toHaveBeenCalledWith(
        testCase.expected,
      );

      harness.unmount();
    }
  });

  it.each([
    { label: "generic", providers: [] },
    { label: "Nette-only", providers: [phpNetteFrameworkProvider] },
  ])("uses core context with $label providers", async ({ providers }) => {
    const source = "<?php route('dashboard');";
    const goToPhpFrameworkIdentifierDefinition = vi.fn(async () => false);
    const goToPhpClassIdentifierDefinition = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "web.php",
        path: `${ROOT}/routes/web.php`,
        savedContent: "",
      },
      activeEditorPositionRef: { current: positionAfter(source, "dashboard") },
      goToPhpClassIdentifierDefinition,
      goToPhpFrameworkIdentifierDefinition,
      providers,
    });
    const harness = renderHook(deps);

    await expect(harness.api().goToContextualPhpDefinition()).resolves.toBe(true);
    expect(goToPhpFrameworkIdentifierDefinition).toHaveBeenCalledWith({
      kind: "classIdentifier",
      name: "dashboard",
    });
    expect(goToPhpClassIdentifierDefinition).toHaveBeenCalledWith("dashboard");

    harness.unmount();
  });

  it("ignores non-PHP documents", async () => {
    const deps = makeDeps({
      activeDocument: {
        content: "const value = service.run();",
        language: "typescript",
        name: "index.ts",
        path: `${ROOT}/src/index.ts`,
        savedContent: "",
      },
    });
    const harness = renderHook(deps);

    await expect(harness.api().goToContextualPhpDefinition()).resolves.toBe(
      false,
    );

    harness.unmount();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}
