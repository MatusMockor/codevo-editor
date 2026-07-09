// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
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
    goToPhpFrameworkLiteralDefinition: vi.fn(async () => false),
    goToPhpClassConstantDefinition: falseHandler,
    goToPhpClassIdentifierDefinition: vi.fn(async () => false),
    goToPhpLaravelAuthGuardDefinition: falseHandler,
    goToPhpLaravelBroadcastConnectionDefinition: falseHandler,
    goToPhpLaravelCacheStoreDefinition: falseHandler,
    goToPhpLaravelDatabaseConnectionDefinition: falseHandler,
    goToPhpLaravelGateAbilityDefinition: falseHandler,
    goToPhpLaravelLogChannelDefinition: falseHandler,
    goToPhpLaravelMailMailerDefinition: falseHandler,
    goToPhpLaravelMiddlewareAliasDefinition: falseHandler,
    goToPhpLaravelPasswordBrokerDefinition: falseHandler,
    goToPhpLaravelQueueConnectionDefinition: falseHandler,
    goToPhpLaravelRedisConnectionDefinition: falseHandler,
    goToPhpLaravelRelationStringDefinition: falseHandler,
    goToPhpLaravelStorageDiskDefinition: falseHandler,
    goToPhpMemberPropertyDefinition: falseHandler,
    goToPhpMethodCallDefinition: falseHandler,
    goToPhpStaticMethodCallDefinition: falseHandler,
    openDirectPhpMethodTarget: vi.fn(async () => false),
    openPhpClassTarget: vi.fn(async () => true),
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
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "Controller.php",
        path: `${ROOT}/app/Controller.php`,
        savedContent: "",
      },
      activeEditorPositionRef: { current: positionAfter(source, "Report") },
      goToPhpClassIdentifierDefinition,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToContextualPhpDefinition();

    expect(handled).toBe(true);
    expect(goToPhpClassIdentifierDefinition).toHaveBeenCalledWith(
      "ReportService",
    );

    harness.unmount();
  });

  it("falls back to opening the controller class for missing route action methods", async () => {
    const source = `<?php
use App\\Http\\Controllers\\ReportController;

Route::get('/reports', [ReportController::class, 'store']);`;
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpClassTarget = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "web.php",
        path: `${ROOT}/routes/web.php`,
        savedContent: "",
      },
      activeEditorPositionRef: { current: positionAfter(source, "sto") },
      openDirectPhpMethodTarget,
      openPhpClassTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToContextualPhpDefinition();

    expect(handled).toBe(true);
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

  it("delegates provider-backed Laravel literal contexts to the framework literal strategy", async () => {
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
      const goToPhpFrameworkLiteralDefinition = vi.fn(async () => true);
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
        goToPhpFrameworkLiteralDefinition,
      });
      const harness = renderHook(deps);

      const handled = await harness.api().goToContextualPhpDefinition();

      expect(handled, testCase.source).toBe(true);
      expect(goToPhpFrameworkLiteralDefinition).toHaveBeenCalledWith(
        testCase.expected,
      );

      harness.unmount();
    }
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
